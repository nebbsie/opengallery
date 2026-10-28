import * as fs from 'node:fs';
import path from 'node:path';
import { and, eq, exists, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  AlbumFileTable,
  AlbumTable,
  FaceRejectionTable,
  FaceTable,
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
import { refreshPeople } from '../faces/people.js';

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

export async function deleteFilesWithCascade(fileIds: string[]) {
  if (!fileIds.length) return [];

  const idsToDelete = Array.from(new Set([...fileIds]));

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
