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
  SharedItemTable,
  VideoMetadataTable,
  ViewerHiddenFileTable,
  ViewerHiddenPersonTable,
} from '../db/schema.js';
import { clearScopeCache } from '../authz/shared-access.js';
import { resolveAssetPath } from './media-path.js';
import { invalidateFaceIndex, removeFromIndexes, withFaceLock } from '../faces/face-index.js';
import { addToClipIndex, removeFromClipIndex } from '../clip/clip-index.js';
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

// ---------- Camera RAW+JPEG pairs (utils/raw-pairing.ts) ----------
//
// When a pair forms or splits, the photo-level data moves from one file row to
// the other instead of being deleted: faces (with their names, user answers and
// rejections, which are keyed by face id), GPS, metadata, the search embedding,
// albums, libraries, shares and per-viewer hide rules. Boxes are normalized and
// it is the same frame, so a moved face still fits; the next detection keeps it
// by box overlap. The database part runs in one synchronous transaction under
// the face lock; disk cleanup and the in-memory indexes are updated after the
// commit (RawMoveEffects).

export type RawMoveEffects = {
  // Variant and preview files to unlink once the rows are gone.
  unlink: string[];
  // Files whose RAW preview cache can go.
  previewFileIds: string[];
  // Source files that kept faces because the target already had some.
  leftoverFaceFiles: string[];
  facesMoved: boolean;
  clipRemove: string[];
  clipAdd: Array<{ fileId: string; model: string; b64: string }>;
};

export function emptyRawEffects(): RawMoveEffects {
  return {
    unlink: [],
    previewFileIds: [],
    leftoverFaceFiles: [],
    facesMoved: false,
    clipRemove: [],
    clipAdd: [],
  };
}

// Tasks that decode a RAW through its cached preview.
const PREVIEW_TASKS = ['encode_thumbnail', 'encode_optimised', 'detect_faces', 'embed_clip'] as const;

/**
 * Drop the cached RAW preview (5-10 MB) of RAW files whose decode tasks are
 * all done (succeeded or skipped). The worker makes it again on demand, for
 * example for a re-encode. Called when a task finishes.
 */
export async function dropRawPreviewsIfDone(fileIds: string[]): Promise<void> {
  const done: string[] = [];
  for (const fileId of new Set(fileIds)) {
    const file = db
      .select({ name: FileTable.name })
      .from(FileTable)
      .where(eq(FileTable.id, fileId))
      .get();
    if (!file || !isRawName(file.name)) continue;
    const open = db
      .select({ one: sql`1` })
      .from(FileTaskTable)
      .where(
        and(
          eq(FileTaskTable.fileId, fileId),
          inArray(FileTaskTable.type, [...PREVIEW_TASKS]),
          sql`${FileTaskTable.status} NOT IN ('succeeded', 'skipped')`,
        ),
      )
      .get();
    if (!open) done.push(fileId);
  }
  await deleteRawPreviews(done);
}

// Add (file, album), (file, library), share and hide-rule links of one file
// to another, skipping the ones it already has. Synchronous.
function copyLinksSync(fromFileId: string, toFileId: string): void {
  const haveAlbums = new Set(
    db
      .select({ albumId: AlbumFileTable.albumId })
      .from(AlbumFileTable)
      .where(eq(AlbumFileTable.fileId, toFileId))
      .all()
      .map((r) => r.albumId),
  );
  const albums = db
    .select({ albumId: AlbumFileTable.albumId })
    .from(AlbumFileTable)
    .where(eq(AlbumFileTable.fileId, fromFileId))
    .all();
  for (const albumId of new Set(albums.map((a) => a.albumId))) {
    if (haveAlbums.has(albumId)) continue;
    db.insert(AlbumFileTable).values({ albumId, fileId: toFileId }).run();
  }

  const haveLibs = new Set(
    db
      .select({ libraryId: LibraryFileTable.libraryId })
      .from(LibraryFileTable)
      .where(eq(LibraryFileTable.fileId, toFileId))
      .all()
      .map((r) => r.libraryId),
  );
  const libs = db
    .select({ libraryId: LibraryFileTable.libraryId })
    .from(LibraryFileTable)
    .where(and(eq(LibraryFileTable.fileId, fromFileId), isNull(LibraryFileTable.deletedAt)))
    .all();
  for (const libraryId of new Set(libs.map((l) => l.libraryId))) {
    if (haveLibs.has(libraryId)) continue;
    db.insert(LibraryFileTable).values({ libraryId, fileId: toFileId }).run();
  }

  // Per-viewer hide rules follow the photo.
  const rules = db
    .select({ viewerUserId: ViewerHiddenFileTable.viewerUserId })
    .from(ViewerHiddenFileTable)
    .where(eq(ViewerHiddenFileTable.fileId, fromFileId))
    .all();
  for (const r of rules) {
    db.insert(ViewerHiddenFileTable)
      .values({ viewerUserId: r.viewerUserId, fileId: toFileId })
      .onConflictDoNothing()
      .run();
  }

  // Direct shares of the file move; one the target already has is dropped.
  const shares = db
    .select()
    .from(SharedItemTable)
    .where(and(eq(SharedItemTable.sourceType, 'file'), eq(SharedItemTable.sourceId, fromFileId)))
    .all();
  if (shares.length) {
    const have = db
      .select()
      .from(SharedItemTable)
      .where(and(eq(SharedItemTable.sourceType, 'file'), eq(SharedItemTable.sourceId, toFileId)))
      .all();
    for (const s of shares) {
      const dupe = have.some(
        (h) => h.shareType === s.shareType && h.sharedToUserId === s.sharedToUserId,
      );
      if (dupe) db.delete(SharedItemTable).where(eq(SharedItemTable.id, s.id)).run();
      else
        db.update(SharedItemTable)
          .set({ sourceId: toFileId, updatedAt: new Date().toISOString() })
          .where(eq(SharedItemTable.id, s.id))
          .run();
    }
  }

  db.update(AlbumTable).set({ cover: toFileId }).where(eq(AlbumTable.cover, fromFileId)).run();
}

// Move the derived photo data of one file to another that has none of that
// kind yet. Synchronous; the caller holds the face lock and a transaction.
function moveFileDataSync(fromId: string, toId: string, fx: RawMoveEffects): void {
  const has = (table: typeof FaceTable | typeof GeoLocationTable | typeof ImageMetadataTable, id: string) =>
    !!db.select({ one: sql`1` }).from(table).where(eq(table.fileId, id)).limit(1).get();

  if (has(FaceTable, fromId)) {
    if (!has(FaceTable, toId)) {
      db.update(FaceTable)
        .set({ fileId: toId, updatedAt: new Date().toISOString() })
        .where(eq(FaceTable.fileId, fromId))
        .run();
      fx.facesMoved = true;
    } else {
      fx.leftoverFaceFiles.push(fromId);
    }
  }
  if (!has(GeoLocationTable, toId)) {
    db.update(GeoLocationTable).set({ fileId: toId }).where(eq(GeoLocationTable.fileId, fromId)).run();
  }
  if (!has(ImageMetadataTable, toId)) {
    const moved = db
      .update(ImageMetadataTable)
      .set({ fileId: toId })
      .where(eq(ImageMetadataTable.fileId, fromId))
      .returning({ takenAt: ImageMetadataTable.takenAt })
      .all();
    if (moved[0]) {
      db.update(FileTable).set({ takenAt: moved[0].takenAt }).where(eq(FileTable.id, toId)).run();
    }
  }
  const emb = db.select().from(FileEmbeddingTable).where(eq(FileEmbeddingTable.fileId, fromId)).get();
  const toEmb = db
    .select({ one: sql`1` })
    .from(FileEmbeddingTable)
    .where(eq(FileEmbeddingTable.fileId, toId))
    .get();
  if (emb && !toEmb) {
    db.update(FileEmbeddingTable)
      .set({ fileId: toId })
      .where(eq(FileEmbeddingTable.fileId, fromId))
      .run();
    fx.clipRemove.push(fromId);
    fx.clipAdd.push({ fileId: toId, model: emb.model, b64: emb.vec.toString('base64') });
  }
  copyLinksSync(fromId, toId);
}

/**
 * A RAW-only photo got a JPEG partner. Synchronous, inside the caller's
 * transaction: move its photo data to the JPEG (moveFileDataSync), then drop
 * what made it a photo of its own (variants, tasks, links, rules). Also used by
 * the reconcile pass for a companion that still holds such rows.
 */
export function demoteRawFilesSync(
  primaryOf: Map<string, string>,
  rawIds: string[],
  fx: RawMoveEffects,
): void {
  for (const rawId of rawIds) {
    const photoId = primaryOf.get(rawId);
    if (!photoId) continue;
    moveFileDataSync(rawId, photoId, fx);

    const variants = db
      .select({ fileId: FileVariantTable.fileId, dir: FileTable.dir, name: FileTable.name })
      .from(FileVariantTable)
      .innerJoin(FileTable, eq(FileTable.id, FileVariantTable.fileId))
      .where(eq(FileVariantTable.originalFileId, rawId))
      .all();
    fx.unlink.push(...variants.map((v) => path.resolve(path.join(v.dir, v.name))));
    db.delete(FileVariantTable).where(eq(FileVariantTable.originalFileId, rawId)).run();
    if (variants.length) {
      db.delete(FileTable).where(inArray(FileTable.id, variants.map((v) => v.fileId))).run();
    }
    // What is left had a counterpart on the photo already.
    db.delete(ImageMetadataTable).where(eq(ImageMetadataTable.fileId, rawId)).run();
    db.delete(VideoMetadataTable).where(eq(VideoMetadataTable.fileId, rawId)).run();
    db.delete(GeoLocationTable).where(eq(GeoLocationTable.fileId, rawId)).run();
    if (db.select({ one: sql`1` }).from(FileEmbeddingTable).where(eq(FileEmbeddingTable.fileId, rawId)).get()) {
      db.delete(FileEmbeddingTable).where(eq(FileEmbeddingTable.fileId, rawId)).run();
      fx.clipRemove.push(rawId);
    }
    db.delete(AlbumFileTable).where(eq(AlbumFileTable.fileId, rawId)).run();
    db.delete(LibraryFileTable).where(eq(LibraryFileTable.fileId, rawId)).run();
    db.delete(FileTaskTable).where(eq(FileTaskTable.fileId, rawId)).run();
    db.delete(ViewerHiddenFileTable).where(eq(ViewerHiddenFileTable.fileId, rawId)).run();
    // Takes the RAW out of the denormalized sort column too.
    db.update(FileTable).set({ takenAt: null }).where(eq(FileTable.id, rawId)).run();
    fx.previewFileIds.push(rawId);
  }
}

/** After the commit: disk cleanup and the in-memory indexes. */
export async function finishRawMoves(fx: RawMoveEffects): Promise<void> {
  if (fx.facesMoved) invalidateFaceIndex();
  removeFromClipIndex(fx.clipRemove);
  for (const a of fx.clipAdd) addToClipIndex(a.fileId, a.model, a.b64);
  if (fx.leftoverFaceFiles.length) await removeFacesForFiles(fx.leftoverFaceFiles, false);
  await deleteRawPreviews(fx.previewFileIds);
  for (const p of fx.unlink) {
    try {
      await fs.promises.unlink(await resolveAssetPath(p));
    } catch {
      // Best-effort: already gone.
    }
  }
  clearScopeCache();
}

/**
 * Photos in `deletedIds` whose RAW companion stays: the RAW becomes a photo of
 * its own and takes over the photo's faces, GPS, metadata, embedding, albums,
 * libraries, shares and hide rules (so a viewer who has a person hidden never
 * sees it), plus new tasks. A RAW that is gone from disk too is returned, for
 * the caller to delete with the photo.
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
  const keep: Array<{ photoId: string; rawId: string }> = [];
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
    keep.push({ photoId: p.id, rawId });
  }
  if (keep.length) {
    const fx = emptyRawEffects();
    await withFaceLock(async () =>
      db.transaction(() => {
        for (const { photoId, rawId } of keep) {
          db.update(FileTable).set({ rawFileId: null }).where(eq(FileTable.id, photoId)).run();
          moveFileDataSync(photoId, rawId, fx);
          db.insert(FileTaskTable).values(fileTaskRows(rawId, 'image')).onConflictDoNothing().run();
        }
      }),
    );
    await finishRawMoves(fx);
  }
  return gone;
}

/**
 * Repair RAW pairs left half-done (a crash, or a worker write that raced a
 * demotion): a companion that still holds library, album, task, variant,
 * metadata, GPS, face, embedding, share or hide-rule rows is demoted again,
 * and a photo of a pair with no library link gets the link of a file in the
 * same folder, its folder album and its tasks. Idempotent; the worker calls it
 * on boot.
 */
export async function reconcileRawPairs(): Promise<{ demoted: number; relinked: number }> {
  const pairs = await db
    .select({ photoId: FileTable.id, rawId: FileTable.rawFileId, dir: FileTable.dir })
    .from(FileTable)
    .where(isNotNull(FileTable.rawFileId));
  if (pairs.length === 0) return { demoted: 0, relinked: 0 };

  const rawIds = pairs.map((p) => p.rawId!);
  const dirty = new Set<string>();
  const probes: Array<(ids: string[]) => Array<{ id: string }>> = [
    (ids) => db.selectDistinct({ id: LibraryFileTable.fileId }).from(LibraryFileTable).where(inArray(LibraryFileTable.fileId, ids)).all(),
    (ids) => db.selectDistinct({ id: AlbumFileTable.fileId }).from(AlbumFileTable).where(inArray(AlbumFileTable.fileId, ids)).all(),
    (ids) => db.selectDistinct({ id: FileTaskTable.fileId }).from(FileTaskTable).where(inArray(FileTaskTable.fileId, ids)).all(),
    (ids) => db.selectDistinct({ id: FileVariantTable.originalFileId }).from(FileVariantTable).where(inArray(FileVariantTable.originalFileId, ids)).all(),
    (ids) => db.selectDistinct({ id: ImageMetadataTable.fileId }).from(ImageMetadataTable).where(inArray(ImageMetadataTable.fileId, ids)).all(),
    (ids) => db.selectDistinct({ id: GeoLocationTable.fileId }).from(GeoLocationTable).where(inArray(GeoLocationTable.fileId, ids)).all(),
    (ids) => db.selectDistinct({ id: FaceTable.fileId }).from(FaceTable).where(inArray(FaceTable.fileId, ids)).all(),
    (ids) => db.selectDistinct({ id: FileEmbeddingTable.fileId }).from(FileEmbeddingTable).where(inArray(FileEmbeddingTable.fileId, ids)).all(),
    (ids) => db.selectDistinct({ id: ViewerHiddenFileTable.fileId }).from(ViewerHiddenFileTable).where(inArray(ViewerHiddenFileTable.fileId, ids)).all(),
    (ids) =>
      db
        .selectDistinct({ id: SharedItemTable.sourceId })
        .from(SharedItemTable)
        .where(and(eq(SharedItemTable.sourceType, 'file'), inArray(SharedItemTable.sourceId, ids)))
        .all(),
  ];
  for (const probe of probes) {
    for (let i = 0; i < rawIds.length; i += 500) {
      for (const r of probe(rawIds.slice(i, i + 500))) dirty.add(r.id);
    }
  }

  const fx = emptyRawEffects();
  const primaryOf = new Map(pairs.map((p) => [p.rawId!, p.photoId]));
  let relinked = 0;
  await withFaceLock(async () =>
    db.transaction(() => {
      demoteRawFilesSync(primaryOf, [...dirty], fx);
      for (const p of pairs) {
        const linked = db
          .select({ one: sql`1` })
          .from(LibraryFileTable)
          .where(eq(LibraryFileTable.fileId, p.photoId))
          .get();
        if (linked) continue;
        const sibling = db
          .select({ libraryId: LibraryFileTable.libraryId })
          .from(LibraryFileTable)
          .innerJoin(FileTable, eq(FileTable.id, LibraryFileTable.fileId))
          .where(and(eq(FileTable.dir, p.dir), isNull(LibraryFileTable.deletedAt)))
          .limit(1)
          .get();
        if (!sibling) continue;
        db.insert(LibraryFileTable).values({ libraryId: sibling.libraryId, fileId: p.photoId }).run();
        const album = db
          .select({ id: AlbumTable.id })
          .from(AlbumTable)
          .where(and(eq(AlbumTable.libraryId, sibling.libraryId), eq(AlbumTable.dir, p.dir)))
          .get();
        if (
          album &&
          !db
            .select({ one: sql`1` })
            .from(AlbumFileTable)
            .where(and(eq(AlbumFileTable.albumId, album.id), eq(AlbumFileTable.fileId, p.photoId)))
            .get()
        ) {
          db.insert(AlbumFileTable).values({ albumId: album.id, fileId: p.photoId }).run();
        }
        db.insert(FileTaskTable).values(fileTaskRows(p.photoId, 'image')).onConflictDoNothing().run();
        relinked++;
      }
    }),
  );
  await finishRawMoves(fx);
  return { demoted: dirty.size, relinked };
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
