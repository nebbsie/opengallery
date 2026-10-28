import * as fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { TrashItemTable, type TrashItemKind } from "../db/schema.js";
import { logger } from "../logger.js";
import { resolveAssetPath } from "./media-path.js";

// Deletes from the UI move the original into a hidden ".trash" folder in the
// same folder, and a trash_item row records where it went. The media drive is
// a mergerfs pool: a rename across its disks fails with EXDEV, and a folder
// next to the file is on the same disk, so the move is a cheap rename.
// Scanner and watcher both skip dot folders, so trashed files are not imported.
export const TRASH_DIR = ".trash";

export class MediaWriteError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

// A reason a person can act on, for a failed write to the media folder.
export function describeWriteError(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "EROFS") return "The media folder is read-only";
  if (code === "EACCES" || code === "EPERM") return "No permission to change the media folder";
  if (code === "ENOENT") return "The file is no longer on the drive";
  if (code === "EEXIST" || code === "ENOTEMPTY") return "A file or folder with that name already exists";
  if (code === "EXDEV") return "The move crosses drives";
  if (e instanceof MediaWriteError) return e.message;
  return (e as Error)?.message ?? "Unknown error";
}

// A free path inside dir for name: "name", then "name (2)", "name (3)", ...
function freePath(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${stem} (${i})${ext}`);
  }
  return candidate;
}

function folderStats(dir: string): { size: number; files: number } {
  let size = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    try {
      size += fs.statSync(path.join(entry.parentPath, entry.name)).size;
      files++;
    } catch {
      // Gone while counting.
    }
  }
  return { size, files };
}

// Move one file or folder (a DB-style absolute path) to the trash. Returns the
// trash row, or throws an error that describeWriteError explains. A missing
// original is not an error for the caller to show: it returns null.
export async function moveToTrash(
  dbPath: string,
  kind: TrashItemKind,
  deletedBy: string | null,
): Promise<typeof TrashItemTable.$inferSelect | null> {
  const real = await resolveAssetPath(path.resolve(dbPath));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const { size, files } =
    kind === "folder" ? folderStats(real) : { size: stat.size, files: 1 };

  const trashDir = path.join(path.dirname(real), TRASH_DIR);
  fs.mkdirSync(trashDir, { recursive: true });
  const target = freePath(trashDir, path.basename(real));
  fs.renameSync(real, target);

  const [row] = await db
    .insert(TrashItemTable)
    .values({
      kind,
      name: path.basename(dbPath),
      originalPath: path.resolve(dbPath),
      trashPath: target,
      size,
      fileCount: files,
      deletedBy,
    })
    .returning();
  logger.info(`[trash] ${real} -> ${target}`);
  return row!;
}

// Put trashed items back where they were. The watcher sees the files appear
// and imports them again (as new files: faces and edits are not kept).
export async function restoreFromTrash(ids: string[]) {
  const rows = ids.length
    ? await db.select().from(TrashItemTable).where(inArray(TrashItemTable.id, ids))
    : [];
  const restored: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const r of rows) {
    try {
      // The trash folder sits next to the original, so the original's folder is
      // the parent of ".trash" (r.originalPath is the DB path, for display).
      const dest = path.join(path.dirname(path.dirname(r.trashPath)), r.name);
      if (fs.existsSync(dest)) throw new MediaWriteError("Something with that name is there now", "EEXIST");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(r.trashPath, dest);
      await db.delete(TrashItemTable).where(eq(TrashItemTable.id, r.id));
      removeTrashDirIfEmpty(path.dirname(r.trashPath));
      restored.push(r.id);
    } catch (e) {
      failed.push({ name: r.name, reason: describeWriteError(e) });
    }
  }
  return { restored: restored.length, failed };
}

// Delete trashed items from the drive for good.
export async function emptyTrash(ids: string[] | null) {
  const rows =
    ids === null
      ? await db.select().from(TrashItemTable)
      : ids.length
        ? await db.select().from(TrashItemTable).where(inArray(TrashItemTable.id, ids))
        : [];
  let removed = 0;
  let freed = 0;
  const failed: { name: string; reason: string }[] = [];
  for (const r of rows) {
    try {
      await fs.promises.rm(r.trashPath, { recursive: true, force: true });
      await db.delete(TrashItemTable).where(eq(TrashItemTable.id, r.id));
      removeTrashDirIfEmpty(path.dirname(r.trashPath));
      removed++;
      freed += r.size;
    } catch (e) {
      failed.push({ name: r.name, reason: describeWriteError(e) });
    }
  }
  return { removed, freed, failed };
}

function removeTrashDirIfEmpty(dir: string) {
  if (path.basename(dir) !== TRASH_DIR) return;
  try {
    fs.rmdirSync(dir);
  } catch {
    // Not empty, or already gone.
  }
}

// Check a new folder or file name: one path segment, no dot prefix (hidden
// files are skipped by the scanner), and nothing the OS rejects.
export function validName(name: string): string {
  const n = name.trim();
  if (!n) throw new MediaWriteError("Enter a name", undefined);
  if (n.length > 200) throw new MediaWriteError("The name is too long", undefined);
  if (n.startsWith(".")) throw new MediaWriteError("The name cannot start with a dot", undefined);
  if (/[/\\\0]/.test(n)) throw new MediaWriteError("The name cannot contain / or \\", undefined);
  return n;
}
