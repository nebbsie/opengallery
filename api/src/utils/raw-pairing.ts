import { createHash } from "node:crypto";
import path from "node:path";
import { eq, inArray, notExists, sql, type SQL } from "drizzle-orm";
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

// SQL condition: the file is not the RAW companion of another file. The worker
// backfills and Settings > Duplicates look at every file row, so they need it;
// the browse queries do not (a companion has no variants, metadata or library
// rows).
export function notRawCompanion(fileIdColumn: SQLiteColumn): SQL {
  const primary = alias(FileTable, "raw_primary");
  return notExists(
    db
      .select({ one: sql`1` })
      .from(primary)
      .where(eq(primary.rawFileId, fileIdColumn)),
  );
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

// Ids in the list that are RAW companions.
export function companionIdsIn(fileIds: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < fileIds.length; i += 500) {
    const rows = db
      .select({ rawFileId: FileTable.rawFileId })
      .from(FileTable)
      .where(inArray(FileTable.rawFileId, fileIds.slice(i, i + 500)))
      .all();
    for (const r of rows) if (r.rawFileId) out.add(r.rawFileId);
  }
  return out;
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
