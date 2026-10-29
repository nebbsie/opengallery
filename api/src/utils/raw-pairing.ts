import { createHash } from "node:crypto";
import path from "node:path";
import { eq, inArray, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import { FileTable } from "../db/schema.js";

// Camera RAW files. A RAW with a photo of the same base name (case-insensitive)
// in the same folder is one photo: the photo (usually the camera's JPEG) is
// what shows, and the RAW is its hidden companion (file.raw_file_id on the
// photo). A RAW with no such photo is a normal photo of its own; the worker
// decodes the camera's embedded JPEG preview for it. Keep this list in step
// with worker/src/utils/media-types.ts and uploads/sniff.ts.
export const RAW_EXTENSIONS = new Set([
  "rw2", "nef", "cr2", "cr3", "arw", "dng", "raf", "orf", "pef", "srw",
]);

export const RAW_MIME: Record<string, string> = {
  rw2: "image/x-panasonic-rw2",
  nef: "image/x-nikon-nef",
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  arw: "image/x-sony-arw",
  dng: "image/x-adobe-dng",
  raf: "image/x-fuji-raf",
  orf: "image/x-olympus-orf",
  pef: "image/x-pentax-pef",
  srw: "image/x-samsung-srw",
};

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// Base name without the extension, lowercased: "P1320887.RW2" and
// "p1320887.jpg" have the same key.
function stemKey(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

export function isRawName(name: string): boolean {
  return RAW_EXTENSIONS.has(extOf(name));
}

// For the grid badge: the photo has a RAW companion, or is a RAW itself.
export function hasRawOf(f: { rawFileId?: string | null; name: string }): boolean {
  return !!f.rawFileId || isRawName(f.name);
}

// SQL condition: the file is not a hidden companion of another file (the RAW
// of a RAW+JPEG pair, or the motion video of a Live Photo). The worker
// backfills and Settings > Duplicates look at every file row, so they need it;
// the browse queries do not (a companion has no library rows).
export function notRawCompanion(fileIdColumn: SQLiteColumn): SQL {
  const primary = alias(FileTable, "raw_primary");
  return notExists(
    db
      .select({ one: sql`1` })
      .from(primary)
      .where(or(eq(primary.rawFileId, fileIdColumn), eq(primary.motionFileId, fileIdColumn))),
  );
}

// True when the file is the motion video of a Live Photo.
export function isMotionCompanion(fileId: string): boolean {
  return !!db
    .select({ id: FileTable.id })
    .from(FileTable)
    .where(eq(FileTable.motionFileId, fileId))
    .limit(1)
    .get();
}

// True when the file is the RAW companion of another file. Internal writers
// (variants, metadata, faces, embeddings, GPS) call it so a worker job that
// was running when its file became a companion cannot make it show again.
export function isRawCompanion(fileId: string): boolean {
  const row = db
    .select({ id: FileTable.id })
    .from(FileTable)
    .where(eq(FileTable.rawFileId, fileId))
    .limit(1)
    .get();
  return !!row;
}

// The photo a RAW companion belongs to, or null.
export function primaryOfRaw(fileId: string): string | null {
  const row = db
    .select({ id: FileTable.id })
    .from(FileTable)
    .where(eq(FileTable.rawFileId, fileId))
    .limit(1)
    .get();
  return row?.id ?? null;
}

// Where the worker caches the upright JPEG it extracts from a RAW
// (worker/src/utils/raw.ts rawPreviewPath). Same stable hash as the variant
// folders: the content hash, or the path hash when there is none.
export function rawPreviewCachePath(
  variantsPath: string,
  file: { dir: string; name: string; contentHash: string | null },
): string {
  const hash = file.contentHash
    ? file.contentHash.slice(0, 16)
    : createHash("sha256").update(path.join(file.dir, file.name)).digest("hex").slice(0, 16);
  return path.join(variantsPath, "raw-previews", `${hash}.jpg`);
}

type PairRow = {
  id: string;
  dir: string;
  name: string;
  type: string;
  rawFileId: string | null;
};

export type PairResult = {
  // New files that became a hidden companion. They get no tasks, library or
  // album rows.
  companions: Set<string>;
  // Files that were already in the library as RAW-only photos and are now the
  // companion of a new photo. Their derived data must be removed
  // (file-operations.ts demoteRawFiles).
  demoted: string[];
  // RAW id -> the photo it now belongs to, for both lists above.
  primaryOf: Map<string, string>;
};

// Photo preference when a folder has more than one photo with the same base
// name: the camera JPEG first.
function photoRank(name: string): number {
  const ext = extOf(name);
  return ext === "jpg" || ext === "jpeg" ? 0 : 1;
}

/**
 * Link newly inserted files with their RAW partners in the same folder. Order
 * of discovery does not matter: a new RAW joins an existing photo, and a new
 * photo takes over an existing RAW-only photo (returned in `demoted`).
 * Synchronous (better-sqlite3), so it can run inside a transaction.
 */
export function linkRawPairs(newFileIds: string[]): PairResult {
  const result: PairResult = { companions: new Set(), demoted: [], primaryOf: new Map() };
  if (newFileIds.length === 0) return result;

  const newRows: PairRow[] = [];
  for (let i = 0; i < newFileIds.length; i += 500) {
    newRows.push(
      ...db
        .select({
          id: FileTable.id,
          dir: FileTable.dir,
          name: FileTable.name,
          type: FileTable.type,
          rawFileId: FileTable.rawFileId,
        })
        .from(FileTable)
        .where(inArray(FileTable.id, newFileIds.slice(i, i + 500)))
        .all(),
    );
  }
  const newIds = new Set(newRows.map((r) => r.id));

  // Only folders where a new image could pair with something.
  const stemsByDir = new Map<string, Set<string>>();
  for (const r of newRows) {
    if (r.type !== "image") continue;
    const set = stemsByDir.get(r.dir) ?? new Set<string>();
    set.add(stemKey(r.name));
    stemsByDir.set(r.dir, set);
  }

  for (const [dir, stems] of stemsByDir) {
    const dirRows: PairRow[] = db
      .select({
        id: FileTable.id,
        dir: FileTable.dir,
        name: FileTable.name,
        type: FileTable.type,
        rawFileId: FileTable.rawFileId,
      })
      .from(FileTable)
      .where(eq(FileTable.dir, dir))
      .all();

    // RAWs that already belong to a photo (the photo is always in the same
    // folder, so this folder's rows are enough).
    const taken = new Set(
      dirRows.map((r) => r.rawFileId).filter((v): v is string => !!v),
    );

    for (const stem of stems) {
      const group = dirRows.filter((r) => r.type === "image" && stemKey(r.name) === stem);
      const raws = group
        .filter((r) => isRawName(r.name) && !taken.has(r.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      const photos = group
        .filter((r) => !isRawName(r.name) && !r.rawFileId)
        .sort((a, b) => photoRank(a.name) - photoRank(b.name) || a.name.localeCompare(b.name));

      for (let i = 0; i < Math.min(raws.length, photos.length); i++) {
        const raw = raws[i]!;
        const photo = photos[i]!;
        // Two old rows that are not linked stay as they are: only a new file
        // makes a pair, so a RAW that was promoted on purpose is not taken
        // back by a scan.
        if (!newIds.has(raw.id) && !newIds.has(photo.id)) continue;
        db.update(FileTable)
          .set({ rawFileId: raw.id, updatedAt: new Date().toISOString() })
          .where(eq(FileTable.id, photo.id))
          .run();
        photo.rawFileId = raw.id;
        taken.add(raw.id);
        result.primaryOf.set(raw.id, photo.id);
        if (newIds.has(raw.id)) result.companions.add(raw.id);
        else result.demoted.push(raw.id);
      }
    }
  }
  return result;
}

// Ids in the list that are hidden companions (RAW or Live Photo motion).
export function companionIdsIn(fileIds: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < fileIds.length; i += 500) {
    const chunk = fileIds.slice(i, i + 500);
    const rows = db
      .select({ rawFileId: FileTable.rawFileId, motionFileId: FileTable.motionFileId })
      .from(FileTable)
      .where(or(inArray(FileTable.rawFileId, chunk), inArray(FileTable.motionFileId, chunk)))
      .all();
    for (const r of rows) {
      if (r.rawFileId && chunk.includes(r.rawFileId)) out.add(r.rawFileId);
      if (r.motionFileId && chunk.includes(r.motionFileId)) out.add(r.motionFileId);
    }
  }
  return out;
}

// Live Photo motion videos of the given stills (still id -> video id).
export function motionIdsOf(fileIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < fileIds.length; i += 500) {
    const rows = db
      .select({ id: FileTable.id, motionFileId: FileTable.motionFileId })
      .from(FileTable)
      .where(inArray(FileTable.id, fileIds.slice(i, i + 500)))
      .all();
    for (const r of rows) if (r.motionFileId) out.set(r.id, r.motionFileId);
  }
  return out;
}

// ---------- Live Photos ----------
//
// An iPhone (or Google Takeout) Live Photo is a still and a short video with
// the same base name in the same folder: IMG_1234.HEIC + IMG_1234.MOV. The
// still shows; the video is its hidden motion companion (file.motion_file_id
// on the still). Unlike a RAW companion the video keeps its encode tasks, so
// the viewer can play a browser-friendly copy.

export const MOTION_STILL_EXTENSIONS = new Set(["heic", "heif", "jpg", "jpeg"]);
export const MOTION_VIDEO_EXTENSIONS = new Set(["mov", "mp4"]);
// Live Photo videos are about 3 s; a longer clip with the same name is a real
// video and stays one.
export const MOTION_MAX_BYTES = 20 * 1024 * 1024;
// The only tasks a motion video gets: a poster and a small playable mp4.
export const MOTION_TASK_TYPES = ["video_poster", "encode_optimised"] as const;

type MotionRow = {
  id: string;
  dir: string;
  name: string;
  type: string;
  size: number;
  rawFileId: string | null;
  motionFileId: string | null;
};

function isMotionStill(r: MotionRow): boolean {
  return r.type === "image" && MOTION_STILL_EXTENSIONS.has(extOf(r.name));
}

function isMotionVideo(r: MotionRow): boolean {
  return r.type === "video" && MOTION_VIDEO_EXTENSIONS.has(extOf(r.name)) && r.size <= MOTION_MAX_BYTES;
}

export type MotionPairResult = {
  // New videos that became a hidden motion companion: no library or album
  // rows, only MOTION_TASK_TYPES.
  companions: Set<string>;
  // Videos that were already in the library as videos of their own and now
  // belong to a still (file-operations.ts demoteMotionFilesSync).
  demoted: string[];
  // Video id -> its still, for both lists above.
  stillOf: Map<string, string>;
};

const motionColumns = {
  id: FileTable.id,
  dir: FileTable.dir,
  name: FileTable.name,
  type: FileTable.type,
  size: FileTable.size,
  rawFileId: FileTable.rawFileId,
  motionFileId: FileTable.motionFileId,
};

/**
 * Link files with their Live Photo partners in the same folder, either order.
 * Only a pair with at least one new file forms (as linkRawPairs), unless
 * `includeOld` is set: the boot reconcile pairs a library imported before
 * Live Photos existed. Synchronous (better-sqlite3), so it can run inside a
 * transaction.
 */
export function linkMotionPairs(fileIds: string[], includeOld = false): MotionPairResult {
  const result: MotionPairResult = { companions: new Set(), demoted: [], stillOf: new Map() };
  if (fileIds.length === 0) return result;

  const rows: MotionRow[] = [];
  for (let i = 0; i < fileIds.length; i += 500) {
    rows.push(
      ...db.select(motionColumns).from(FileTable).where(inArray(FileTable.id, fileIds.slice(i, i + 500))).all(),
    );
  }
  const newIds = includeOld ? null : new Set(rows.map((r) => r.id));

  const stemsByDir = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!isMotionStill(r) && !isMotionVideo(r)) continue;
    const set = stemsByDir.get(r.dir) ?? new Set<string>();
    set.add(stemKey(r.name));
    stemsByDir.set(r.dir, set);
  }

  for (const [dir, stems] of stemsByDir) {
    const dirRows: MotionRow[] = db.select(motionColumns).from(FileTable).where(eq(FileTable.dir, dir)).all();
    const taken = new Set(dirRows.map((r) => r.motionFileId).filter((v): v is string => !!v));
    // A RAW companion is never a still of its own.
    const raws = new Set(dirRows.map((r) => r.rawFileId).filter((v): v is string => !!v));

    for (const stem of stems) {
      const group = dirRows.filter((r) => stemKey(r.name) === stem);
      const videos = group
        .filter((r) => isMotionVideo(r) && !taken.has(r.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      const stills = group
        .filter((r) => isMotionStill(r) && !r.motionFileId && !raws.has(r.id))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (let i = 0; i < Math.min(videos.length, stills.length); i++) {
        const video = videos[i]!;
        const still = stills[i]!;
        if (newIds && !newIds.has(video.id) && !newIds.has(still.id)) continue;
        db.update(FileTable)
          .set({ motionFileId: video.id, updatedAt: new Date().toISOString() })
          .where(eq(FileTable.id, still.id))
          .run();
        still.motionFileId = video.id;
        taken.add(video.id);
        result.stillOf.set(video.id, still.id);
        if (newIds?.has(video.id)) result.companions.add(video.id);
        else result.demoted.push(video.id);
      }
    }
  }
  return result;
}

// RAW companions of the given photos (photo id -> RAW id).
export function rawIdsOf(fileIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < fileIds.length; i += 500) {
    const rows = db
      .select({ id: FileTable.id, rawFileId: FileTable.rawFileId })
      .from(FileTable)
      .where(inArray(FileTable.id, fileIds.slice(i, i + 500)))
      .all();
    for (const r of rows) if (r.rawFileId) out.set(r.id, r.rawFileId);
  }
  return out;
}
