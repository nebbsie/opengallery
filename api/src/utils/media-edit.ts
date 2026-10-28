import * as fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { clearScopeCache } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  FileTable,
  SharedItemTable,
  UploadSessionTable,
} from "../db/schema.js";
import { logger } from "../logger.js";
import { deleteFilesWithCascade } from "./file-operations.js";
import { resolveAssetPath } from "./media-path.js";
import { describeWriteError, MediaWriteError, moveToTrash, validName } from "./media-trash.js";
import { rawIdsOf } from "./raw-pairing.js";

// Edits to the library that change the media folder too: delete files and
// folders (to the trash, see media-trash.ts) and rename folders. The disk
// change comes first; the DB changes only when it worked, so a failed write
// never hides a file that the next scan would bring back.

// Rows whose path is `dir` or under it. Exact prefix: LIKE treats `_` and `%`
// as wildcards and ignores case, which would match sibling folders.
const underDir = (column: AnySQLiteColumn, dir: string) =>
  or(eq(column, dir), sql`substr(${column}, 1, ${dir.length + 1}) = ${dir + "/"}`)!;

export type EditFailure = { id: string; name: string; reason: string };

// Delete files: move each original (and, with withRaw, its RAW companion) to
// the trash, then remove the deleted ones from the library.
export async function trashFiles(
  fileIds: string[],
  deletedBy: string | null,
  opts: { withRaw: boolean } = { withRaw: true },
): Promise<{ deleted: number; failed: EditFailure[] }> {
  const raws = opts.withRaw ? rawIdsOf(fileIds) : new Map<string, string>();
  const ids = [...new Set([...fileIds, ...raws.values()])];
  if (ids.length === 0) return { deleted: 0, failed: [] };
  const rows = await db
    .select({ id: FileTable.id, dir: FileTable.dir, name: FileTable.name })
    .from(FileTable)
    .where(inArray(FileTable.id, ids));

  const done: string[] = [];
  const failed: EditFailure[] = [];
  for (const f of rows) {
    try {
      await moveToTrash(path.join(f.dir, f.name), "file", deletedBy);
      done.push(f.id);
    } catch (e) {
      failed.push({ id: f.id, name: f.name, reason: describeWriteError(e) });
    }
  }
  // A photo whose RAW could not move keeps both, so the pair stays whole.
  const failedIds = new Set(failed.map((f) => f.id));
  const keep = new Set<string>();
  for (const [photo, raw] of raws) {
    if (failedIds.has(photo) || failedIds.has(raw)) {
      keep.add(photo);
      keep.add(raw);
    }
  }
  const remove = done.filter((id) => !keep.has(id));
  if (remove.length) await deleteFilesWithCascade(remove);
  return { deleted: remove.filter((id) => fileIds.includes(id)).length, failed };
}

async function albumRow(albumId: string) {
  const [album] = await db.select().from(AlbumTable).where(eq(AlbumTable.id, albumId)).limit(1);
  if (!album) throw new MediaWriteError("Album not found", undefined);
  return album;
}

// Delete an album folder: move it to the trash, then remove its files, the
// albums under it, and their links and shares.
export async function trashFolder(albumId: string, deletedBy: string | null) {
  const album = await albumRow(albumId);
  const item = await moveToTrash(album.dir, "folder", deletedBy);

  const files = await db
    .select({ id: FileTable.id })
    .from(FileTable)
    .where(underDir(FileTable.dir, album.dir));
  const fileIds = files.map((f) => f.id);
  if (fileIds.length) await deleteFilesWithCascade(fileIds);

  const albums = await db
    .select({ id: AlbumTable.id })
    .from(AlbumTable)
    .where(and(eq(AlbumTable.libraryId, album.libraryId), underDir(AlbumTable.dir, album.dir)));
  const albumIds = albums.map((a) => a.id);
  if (albumIds.length) {
    db.transaction((tx) => {
      tx.delete(AlbumFileTable).where(inArray(AlbumFileTable.albumId, albumIds)).run();
      tx.delete(SharedItemTable)
        .where(and(eq(SharedItemTable.sourceType, "album"), inArray(SharedItemTable.sourceId, albumIds)))
        .run();
      tx.delete(AlbumTable).where(inArray(AlbumTable.id, albumIds)).run();
    });
    clearScopeCache();
  }
  return { files: fileIds.length, albums: albumIds.length, trashed: !!item };
}

// Rename an album folder on disk and in the DB. The rename and the DB update
// run in one synchronous step, so the watcher's events for the move find the
// DB already changed and do nothing (no re-import: faces, shares and encodes
// are kept).
export async function renameFolder(albumId: string, newName: string) {
  const name = validName(newName);
  const album = await albumRow(albumId);
  if (name === path.basename(album.dir)) {
    if (album.name !== name) await db.update(AlbumTable).set({ name }).where(eq(AlbumTable.id, albumId));
    return { dir: album.dir };
  }
  const oldDir = album.dir;
  const newDir = path.join(path.dirname(oldDir), name);
  const realOld = await resolveAssetPath(oldDir);
  const realNew = path.join(path.dirname(realOld), name);
  if (fs.existsSync(realNew)) throw new MediaWriteError("A folder with that name already exists", "EEXIST");

  const [clash] = await db
    .select({ id: AlbumTable.id })
    .from(AlbumTable)
    .where(and(eq(AlbumTable.libraryId, album.libraryId), eq(AlbumTable.dir, newDir)))
    .limit(1);
  if (clash) throw new MediaWriteError("An album with that name already exists here", "EEXIST");

  const swap = (column: AnySQLiteColumn) =>
    sql`${newDir} || substr(${column}, ${oldDir.length + 1})`;
  const now = new Date().toISOString();

  // No await between the rename and the commit (see above).
  fs.renameSync(realOld, realNew);
  try {
    db.transaction((tx) => {
      tx.update(FileTable)
        .set({ dir: swap(FileTable.dir), updatedAt: now })
        .where(underDir(FileTable.dir, oldDir))
        .run();
      tx.update(AlbumTable)
        .set({ dir: swap(AlbumTable.dir), updatedAt: now })
        .where(and(eq(AlbumTable.libraryId, album.libraryId), underDir(AlbumTable.dir, oldDir)))
        .run();
      tx.update(AlbumTable).set({ name }).where(eq(AlbumTable.id, albumId)).run();
      tx.update(UploadSessionTable)
        .set({ destDir: swap(UploadSessionTable.destDir) })
        .where(underDir(UploadSessionTable.destDir, oldDir))
        .run();
    });
  } catch (e) {
    // Put the folder back so disk and DB still agree.
    try {
      fs.renameSync(realNew, realOld);
    } catch (undoError) {
      logger.error(`[rename] could not undo ${realNew} -> ${realOld}: ${undoError}`);
    }
    throw e;
  }
  logger.info(`[rename] ${oldDir} -> ${newDir}`);
  clearScopeCache();
  return { dir: newDir };
}
