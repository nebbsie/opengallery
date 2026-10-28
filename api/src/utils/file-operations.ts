import * as fs from 'node:fs';
import path from 'node:path';
import { and, eq, exists, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  AlbumFileTable,
  AlbumTable,
  FaceRejectionTable,
  FaceTable,
  FileEmbeddingTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
  GeoLocationTable,
  ImageMetadataTable,
  LibraryFileTable,
  VideoMetadataTable,
  ViewerHiddenFileTable,
  ViewerHiddenPersonTable,
} from '../db/schema.js';
import { clearScopeCache } from '../authz/shared-access.js';
import { resolveAssetPath } from './media-path.js';
import { removeFromIndexes, withFaceLock } from '../faces/face-index.js';
import { removeFromClipIndex } from '../clip/clip-index.js';
import { refreshPeople } from '../faces/people.js';
import { getCachedSystemSettings } from './settings-cache.js';
import { isRawName, rawPreviewCachePath } from './raw-pairing.js';

const RULE_CHUNK = 200;

// Insert (viewer, file) hide rows, skipping pairs that already exist.
async function insertViewerHiddenFiles(
  pairs: Array<{ viewerUserId: string; fileId: string }>,
): Promise<void> {
  for (let i = 0; i < pairs.length; i += RULE_CHUNK) {
    await db
      .insert(ViewerHiddenFileTable)
      .values(pairs.slice(i, i + RULE_CHUNK))
      .onConflictDoNothing();
  }
}

/**
 * Turn "person X is hidden from viewer V" into per-file hide rows for the given
 * files, for every face of a viewer-hidden person in them. Called before faces
 * are removed from files that stay in the library (re-detection, content
 * refresh, a full face rescan): without it the photo would show to the viewer
 * between the face removal and the next detection, or for good if the new face
 * lands in a new cluster. Returns true when any rows were written.
 */
export async function pinViewerHiddenFaces(fileIds?: string[]): Promise<boolean> {
  if (fileIds && fileIds.length === 0) return false;
  const pairs: Array<{ viewerUserId: string; fileId: string }> = [];
  const chunks = fileIds
    ? Array.from({ length: Math.ceil(fileIds.length / RULE_CHUNK) }, (_, i) =>
        fileIds.slice(i * RULE_CHUNK, (i + 1) * RULE_CHUNK),
      )
    : [undefined];
  for (const chunk of chunks) {
    const rows = await db
      .selectDistinct({
        viewerUserId: ViewerHiddenPersonTable.viewerUserId,
        fileId: FaceTable.fileId,
      })
      .from(FaceTable)
      .innerJoin(
        ViewerHiddenPersonTable,
        eq(ViewerHiddenPersonTable.personId, FaceTable.personId),
      )
      .where(chunk ? inArray(FaceTable.fileId, chunk) : undefined);
    pairs.push(...rows);
  }
  if (pairs.length === 0) return false;
  await insertViewerHiddenFiles(pairs);
  return true;
}

// Drop the per-viewer hide rules of deleted files. No FKs, so this is manual.
export async function deleteViewerRulesForFiles(fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  for (let i = 0; i < fileIds.length; i += RULE_CHUNK) {
    await db
      .delete(ViewerHiddenFileTable)
      .where(inArray(ViewerHiddenFileTable.fileId, fileIds.slice(i, i + RULE_CHUNK)));
  }
}

// Drop the per-viewer hide rules of deleted people.
export async function deleteViewerRulesForPeople(personIds: string[]): Promise<void> {
  if (personIds.length === 0) return;
  for (let i = 0; i < personIds.length; i += RULE_CHUNK) {
    await db
      .delete(ViewerHiddenPersonTable)
      .where(
        inArray(ViewerHiddenPersonTable.personId, personIds.slice(i, i + RULE_CHUNK)),
      );
  }
}

// Merge: every viewer the source person was hidden from keeps the merged
// person hidden. The (viewer, person) unique index makes the union safe.
export async function moveViewerRulesToPerson(
  sourcePersonId: string,
  targetPersonId: string,
): Promise<void> {
  const rows = await db
    .select({ viewerUserId: ViewerHiddenPersonTable.viewerUserId })
    .from(ViewerHiddenPersonTable)
    .where(eq(ViewerHiddenPersonTable.personId, sourcePersonId));
  if (rows.length > 0) {
    await db
      .insert(ViewerHiddenPersonTable)
      .values(
        rows.map((r) => ({ viewerUserId: r.viewerUserId, personId: targetPersonId })),
      )
      .onConflictDoNothing();
  }
  await deleteViewerRulesForPeople([sourcePersonId]);
}

/**
 * Best-effort unlink of the generated variant files (thumbnails / optimised /
 * posters) produced from the given original files. Each variant is itself a
 * FileTable row, so we resolve its dir/name to an on-disk path the same way the
 * re-encode cleanup and asset routes do. Never touches the user's originals.
 */
export async function deleteVariantFilesFromDisk(
  originalFileIds: string[],
): Promise<void> {
  if (!originalFileIds.length) return;
  const variantFiles = await db
    .select({ dir: FileTable.dir, name: FileTable.name })
    .from(FileVariantTable)
    .innerJoin(FileTable, eq(FileTable.id, FileVariantTable.fileId))
    .where(inArray(FileVariantTable.originalFileId, originalFileIds));

  for (const v of variantFiles) {
    try {
      const abs = await resolveAssetPath(path.resolve(path.join(v.dir, v.name)));
      await fs.promises.unlink(abs);
    } catch {
      // Best-effort: a missing file just means it's already gone.
    }
  }
}

/**
 * Remove all detected faces for the given files and repair the person clusters
 * they belonged to: recompute counts and centroid, drop now-empty clusters,
 * repair a cover that pointed at a removed face, and best-effort unlink the
 * faces' avatar crops from disk. Shared by file deletion (D3), idempotent
 * re-detection (D2), and content-change refresh (D4).
 */
export async function removeFacesForFiles(
  fileIds: string[],
  // False when the files themselves are being deleted. When they stay (re-
  // detection, content refresh), viewer-hidden faces become per-file rules so
  // the photo stays hidden from those viewers.
  filesRemain = true,
): Promise<void> {
  if (!fileIds.length) return;
  // Changes face -> person links, so it must not interleave with live
  // matching or a regroup (faces/face-index.ts withFaceLock).
  await withFaceLock(() => removeFacesForFilesLocked(fileIds, filesRemain));
}

async function removeFacesForFilesLocked(fileIds: string[], filesRemain: boolean): Promise<void> {

  const faces = await db
    .select({
      id: FaceTable.id,
      personId: FaceTable.personId,
      cropDir: FaceTable.cropDir,
      cropName: FaceTable.cropName,
    })
    .from(FaceTable)
    .where(inArray(FaceTable.fileId, fileIds));
  if (faces.length === 0) return;

  const affectedPersonIds = Array.from(
    new Set(faces.map((r) => r.personId).filter((p): p is string => !!p)),
  );

  const pinned = filesRemain ? await pinViewerHiddenFaces(fileIds) : false;
  const faceIds = faces.map((f) => f.id);

  await db.delete(FaceTable).where(inArray(FaceTable.fileId, fileIds));

  for (const f of faces) {
    if (!f.cropDir || !f.cropName) continue;
    try {
      const abs = await resolveAssetPath(
        path.resolve(path.join(f.cropDir, f.cropName)),
      );
      await fs.promises.unlink(abs);
    } catch {
      // Best-effort: already gone.
    }
  }

  removeFromIndexes(faceIds);
  await db.delete(FaceRejectionTable).where(inArray(FaceRejectionTable.faceId, faceIds));
  const deletedPersonIds = await refreshPeople(affectedPersonIds);
  if (pinned || deletedPersonIds.length > 0) clearScopeCache();
}

// The worker tasks a new original gets. Shared by files.create, uploads and a
// RAW that becomes a photo of its own.
export function fileTaskRows(
  fileId: string,
  type: 'image' | 'video',
): (typeof FileTaskTable.$inferInsert)[] {
  const rows: (typeof FileTaskTable.$inferInsert)[] =
    type === 'image'
      ? [
          { fileId, type: 'encode_thumbnail' },
          { fileId, type: 'encode_optimised' },
          { fileId, type: 'detect_faces' },
        ]
      : [
          { fileId, type: 'video_poster' },
          { fileId, type: 'encode_optimised' },
          // Faces from sampled frames (worker face-detection/detect.ts).
          { fileId, type: 'detect_faces' },
        ];
  // Object search embedding (worker clip-worker.ts).
  rows.push({ fileId, type: 'embed_clip' });
  // GPS extraction runs independently of encoding (it only reads EXIF /
  // ffprobe tags off the original) so geolocation lands even when the encode
  // step is skipped because variants already exist.
  rows.push({ fileId, type: 'extract_geolocation' });
  return rows;
}

// Best-effort unlink of the worker's cached RAW previews (never the originals).
export async function deleteRawPreviews(fileIds: string[]): Promise<void> {
  if (!fileIds.length) return;
  const settings = await getCachedSystemSettings();
  const variantsPath = settings?.variantsPath ?? settings?.uploadPath;
  if (!variantsPath) return;
  const rows = await db
    .select({ dir: FileTable.dir, name: FileTable.name, contentHash: FileTable.contentHash })
    .from(FileTable)
    .where(inArray(FileTable.id, fileIds));
  for (const r of rows) {
    if (!isRawName(r.name)) continue;
    try {
      await fs.promises.unlink(await resolveAssetPath(rawPreviewCachePath(variantsPath, r)));
    } catch {
      // Not cached, or already gone.
    }
  }
}

// Add (file, album) / (file, library) links that do not exist yet.
async function copyLinks(fromFileId: string, toFileId: string): Promise<void> {
  const albums = await db
    .select({ albumId: AlbumFileTable.albumId })
    .from(AlbumFileTable)
    .where(eq(AlbumFileTable.fileId, fromFileId));
  const haveAlbums = new Set(
    (
      await db
        .select({ albumId: AlbumFileTable.albumId })
        .from(AlbumFileTable)
        .where(eq(AlbumFileTable.fileId, toFileId))
    ).map((r) => r.albumId),
  );
  const newAlbums = [...new Set(albums.map((a) => a.albumId))].filter((a) => !haveAlbums.has(a));
  if (newAlbums.length) {
    await db
      .insert(AlbumFileTable)
      .values(newAlbums.map((albumId) => ({ albumId, fileId: toFileId })));
  }

  const libs = await db
    .select({ libraryId: LibraryFileTable.libraryId })
    .from(LibraryFileTable)
    .where(and(eq(LibraryFileTable.fileId, fromFileId), isNull(LibraryFileTable.deletedAt)));
  const haveLibs = new Set(
    (
      await db
        .select({ libraryId: LibraryFileTable.libraryId })
        .from(LibraryFileTable)
        .where(eq(LibraryFileTable.fileId, toFileId))
    ).map((r) => r.libraryId),
  );
  const newLibs = [...new Set(libs.map((l) => l.libraryId))].filter((l) => !haveLibs.has(l));
  if (newLibs.length) {
    await db
      .insert(LibraryFileTable)
      .values(newLibs.map((libraryId) => ({ libraryId, fileId: toFileId })));
  }

  // Per-viewer hide rules follow the photo.
  const rules = await db
    .select({ viewerUserId: ViewerHiddenFileTable.viewerUserId })
    .from(ViewerHiddenFileTable)
    .where(eq(ViewerHiddenFileTable.fileId, fromFileId));
  if (rules.length) {
    await insertViewerHiddenFiles(
      rules.map((r) => ({ viewerUserId: r.viewerUserId, fileId: toFileId })),
    );
  }
}

/**
 * A RAW-only photo got a JPEG partner (files.create / uploads linked them).
 * Keep the RAW row as the hidden companion and drop everything that made it a
 * photo of its own: variants, metadata, GPS, faces, embedding, tasks, library
 * and album links. Its manual album links and hide rules move to the photo.
 */
export async function demoteRawFiles(primaryOf: Map<string, string>, rawIds: string[]): Promise<void> {
  if (!rawIds.length) return;
  for (const rawId of rawIds) {
    const photoId = primaryOf.get(rawId);
    if (!photoId) continue;
    await copyLinks(rawId, photoId);
    await db.update(AlbumTable).set({ cover: photoId }).where(eq(AlbumTable.cover, rawId));
  }

  const variantRows = await db
    .select({ fileId: FileVariantTable.fileId })
    .from(FileVariantTable)
    .where(inArray(FileVariantTable.originalFileId, rawIds));
  const variantFileIds = variantRows.map((r) => r.fileId);
  await deleteVariantFilesFromDisk(rawIds);
  await deleteRawPreviews(rawIds);
  await db.delete(VideoMetadataTable).where(inArray(VideoMetadataTable.fileId, rawIds));
  await db.delete(ImageMetadataTable).where(inArray(ImageMetadataTable.fileId, rawIds));
  await db.delete(GeoLocationTable).where(inArray(GeoLocationTable.fileId, rawIds));
  await removeFacesForFiles(rawIds, false);
  await db.delete(FileEmbeddingTable).where(inArray(FileEmbeddingTable.fileId, rawIds));
  removeFromClipIndex(rawIds);
  await db.delete(AlbumFileTable).where(inArray(AlbumFileTable.fileId, rawIds));
  await db.delete(LibraryFileTable).where(inArray(LibraryFileTable.fileId, rawIds));
  await db.delete(FileTaskTable).where(inArray(FileTaskTable.fileId, rawIds));
  await db.delete(FileVariantTable).where(inArray(FileVariantTable.originalFileId, rawIds));
  if (variantFileIds.length) {
    await db.delete(FileTable).where(inArray(FileTable.id, variantFileIds));
  }
  // Takes the RAW out of the denormalized sort column too.
  await db.update(FileTable).set({ takenAt: null }).where(inArray(FileTable.id, rawIds));
  await deleteViewerRulesForFiles(rawIds);
  clearScopeCache();
}

/**
 * Photos in `deletedIds` whose RAW companion stays: the RAW becomes a photo of
 * its own (library and album links of the photo, new tasks). A RAW that is
 * gone from disk too is returned, for the caller to delete with the photo.
 */
async function promoteRawCompanions(deletedIds: string[]): Promise<string[]> {
  const deleting = new Set(deletedIds);
  const pairs: Array<{ id: string; rawFileId: string | null }> = [];
  for (let i = 0; i < deletedIds.length; i += 500) {
    pairs.push(
      ...(await db
        .select({ id: FileTable.id, rawFileId: FileTable.rawFileId })
        .from(FileTable)
        .where(
          and(
            inArray(FileTable.id, deletedIds.slice(i, i + 500)),
            isNotNull(FileTable.rawFileId),
          ),
        )),
    );
  }
  const gone: string[] = [];
  for (const p of pairs) {
    const rawId = p.rawFileId!;
    if (deleting.has(rawId)) continue;
    const [raw] = await db
      .select({ id: FileTable.id, dir: FileTable.dir, name: FileTable.name })
      .from(FileTable)
      .where(eq(FileTable.id, rawId))
      .limit(1);
    if (!raw) continue;
    try {
      await fs.promises.stat(await resolveAssetPath(path.resolve(path.join(raw.dir, raw.name))));
    } catch (e) {
      // Only a clear "not there" deletes it. Any other error (the flaky USB
      // drive) keeps the row; the next scan removes it if it is really gone.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        gone.push(rawId);
        continue;
      }
    }
    await db.update(FileTable).set({ rawFileId: null }).where(eq(FileTable.id, p.id));
    await copyLinks(p.id, rawId);
    await db.insert(FileTaskTable).values(fileTaskRows(rawId, 'image')).onConflictDoNothing();
  }
  return gone;
}

export async function deleteFilesWithCascade(fileIds: string[]) {
  if (!fileIds.length) return [];

  const idsToDelete = Array.from(new Set([...fileIds]));

  // Camera RAW+JPEG pairs: a RAW whose JPEG goes becomes a photo of its own.
  idsToDelete.push(...(await promoteRawCompanions(idsToDelete)));
  await deleteRawPreviews(idsToDelete);

  const variantRows = await db
    .select({ fileId: FileVariantTable.fileId })
    .from(FileVariantTable)
    .where(inArray(FileVariantTable.originalFileId, fileIds));

  const variantFileIds = variantRows.map((r) => r.fileId);
  idsToDelete.push(...variantFileIds);

  // Unlink the generated variant files from disk before dropping their rows,
  // otherwise the AVIF/MP4 outputs orphan on disk forever (D3).
  await deleteVariantFilesFromDisk(idsToDelete);

  await db
    .update(AlbumTable)
    .set({ cover: null })
    .where(inArray(AlbumTable.cover, idsToDelete));

  await db
    .delete(VideoMetadataTable)
    .where(inArray(VideoMetadataTable.fileId, idsToDelete));

  await db
    .delete(ImageMetadataTable)
    .where(inArray(ImageMetadataTable.fileId, idsToDelete));

  await db
    .delete(GeoLocationTable)
    .where(inArray(GeoLocationTable.fileId, idsToDelete));

  // Remove detected faces and repair/clean up their person clusters.
  await removeFacesForFiles(idsToDelete, false);

  await db
    .delete(FileEmbeddingTable)
    .where(inArray(FileEmbeddingTable.fileId, idsToDelete));
  removeFromClipIndex(idsToDelete);

  await db
    .delete(AlbumFileTable)
    .where(inArray(AlbumFileTable.fileId, idsToDelete));

  await db
    .delete(LibraryFileTable)
    .where(inArray(LibraryFileTable.fileId, idsToDelete));

  await db
    .delete(FileTaskTable)
    .where(inArray(FileTaskTable.fileId, idsToDelete));

  await db
    .delete(FileVariantTable)
    .where(
      or(
        inArray(FileVariantTable.originalFileId, idsToDelete),
        inArray(FileVariantTable.fileId, idsToDelete)
      )
    );

  const result = await db
    .delete(FileTable)
    .where(inArray(FileTable.id, idsToDelete))
    .returning({ id: FileTable.id });

  // A deleted RAW companion: its photo just loses the link.
  await db
    .update(FileTable)
    .set({ rawFileId: null })
    .where(inArray(FileTable.rawFileId, idsToDelete));

  // Per-viewer hide rules of the deleted files (no FKs to cascade them).
  await deleteViewerRulesForFiles(idsToDelete);
  clearScopeCache();

  return result;
}

export async function computeAlbumCovers(
  albumIds: string[]
): Promise<Record<string, string | null>> {
  const coverByAlbum: Record<string, string | null> = {};

  const albumsWithCovers = await db
    .select({ id: AlbumTable.id, cover: AlbumTable.cover })
    .from(AlbumTable)
    .where(inArray(AlbumTable.id, albumIds));

  const albumsNeedingCover: string[] = [];
  for (const album of albumsWithCovers) {
    if (album.cover) {
      coverByAlbum[album.id] = album.cover;
    } else {
      albumsNeedingCover.push(album.id);
    }
  }

  if (albumsNeedingCover.length > 0) {
    const computedCovers = await db
      .select({
        albumId: AlbumFileTable.albumId,
        fileId: sql<string>`MIN(${FileTable.id})`,
      })
      .from(AlbumFileTable)
      .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
      .where(
        and(
          inArray(AlbumFileTable.albumId, albumsNeedingCover),
          eq(FileTable.type, 'image'),
          exists(
            db
              .select()
              .from(FileVariantTable)
              .where(
                and(
                  eq(FileVariantTable.originalFileId, FileTable.id),
                  eq(FileVariantTable.type, 'thumbnail')
                )
              )
          )
        )
      )
      .groupBy(AlbumFileTable.albumId);

    for (const { albumId, fileId } of computedCovers) {
      coverByAlbum[albumId] = fileId;
    }

    for (const albumId of albumsNeedingCover) {
      if (!(albumId in coverByAlbum)) {
        coverByAlbum[albumId] = null;
      }
    }
  }

  return coverByAlbum;
}
