import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import * as fsp from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { contributableAlbums, uploadableAlbum } from "../authz/album-contrib.js";
import { inheritOwner } from "../utils/media-trash.js";
import { clearScopeCache } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  FileImportMetaTable,
  GeoLocationTable,
  AlbumTable,
  FileTable,
  FileTaskTable,
  LibraryFileTable,
  LibraryTable,
  MediaPathTable,
  UploadSessionTable,
} from "../db/schema.js";
import { logger } from "../logger.js";
import { withFaceLock } from "../faces/face-index.js";
import {
  demoteMotionFilesSync,
  demoteRawFilesSync,
  emptyRawEffects,
  fileTaskRows,
  finishRawMoves,
  motionTaskRows,
} from "../utils/file-operations.js";
import { linkMotionPairs, linkRawPairs, primaryOfRaw } from "../utils/raw-pairing.js";
import { getCachedSystemSettings } from "../utils/settings-cache.js";
import { wsManager } from "../ws-manager.js";
import { SNIFF_BYTES, finalFileName, sniffMedia } from "./sniff.js";

// Resumable uploads.
//
// Layout on disk (uploads root = Settings > Storage "Uploads location", by
// default <STORAGE_PATH>/uploads, which is /data/uploads in Docker):
//
//   <root>/.partial/<sessionId>.part   bytes received so far
//   <root>/<userId>/<Album>/<file>     finished files
//
// <root>/<userId> is registered as one of the user's media sources, so the
// worker watches and scans it like any other library folder: each subfolder
// is an album, and files go through the normal encode, thumbnail, face and geo
// tasks. On finish the API also inserts the file rows itself (the same rows the
// scanner writes) so the photo shows up at once instead of after the watcher.

export const DEFAULT_ALBUM_NAME = "Uploads";
// Chunk size the web client sends. One request may carry at most
// MAX_CHUNK_BYTES (nginx allows a little more, see nginx.conf).
export const CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_OPEN_SESSIONS = 500;
// Keep this much disk free after an upload.
const FREE_SPACE_MARGIN = 256 * 1024 * 1024;
const STALE_OPEN_MS = 24 * 60 * 60 * 1000;
const STALE_CLOSED_MS = 7 * 24 * 60 * 60 * 1000;
const PARTIAL_DIR = ".partial";
// The scanner and watcher skip folders with these names (worker
// watcher/scanner.ts), so an album must never be called that.
const RESERVED_DIR_NAMES = new Set(["uploads", "variants", "encodes"]);

export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly received?: number,
  ) {
    super(message);
  }
}

type Session = typeof UploadSessionTable.$inferSelect;

// One request at a time per session (a chunk, a finish or a cancel).
const busy = new Set<string>();

async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(id)) {
    throw new UploadError(409, "BUSY", "This upload is already being written");
  }
  busy.add(id);
  try {
    return await fn();
  } finally {
    busy.delete(id);
  }
}

// ---------- paths ----------

export async function getUploadsRoot(): Promise<string | null> {
  const settings = await getCachedSystemSettings();
  const configured = settings?.uploadPath?.trim();
  if (configured) return resolve(configured);
  const storage = process.env["STORAGE_PATH"]?.trim();
  return storage ? resolve(storage, "uploads") : null;
}

export async function getMaxUploadBytes(): Promise<number> {
  const settings = await getCachedSystemSettings();
  return settings?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// One path segment from user input: no separators, no control characters, no
// leading dots (no hidden files and no ".."), at most `max` characters.
export function cleanSegment(raw: string, max = 120): string {
  let s = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (s.length > max) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : "";
    s = s.slice(0, max - ext.length).trim() + ext;
  }
  return s;
}

export function cleanAlbumName(raw: string): string {
  const name = cleanSegment(raw, 100);
  if (RESERVED_DIR_NAMES.has(name.toLowerCase())) {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  return name;
}

function userDirFor(root: string, userId: string): string {
  return join(root, cleanSegment(userId, 64));
}

// The user's uploads folder that holds `dir`, or null.
function userDirOf(dir: string, userId: string): string | null {
  const name = cleanSegment(userId, 64);
  for (let d = dirname(dir); d !== dirname(d); d = dirname(d)) {
    if (basename(d) === name) return isInside(d, dir) ? d : null;
  }
  return null;
}

// ---------- library helpers ----------

async function getDefaultLibraryId(userId: string): Promise<string> {
  const [lib] = await db
    .select({ id: LibraryTable.id })
    .from(LibraryTable)
    .where(eq(LibraryTable.userId, userId))
    .orderBy(LibraryTable.createdAt)
    .limit(1);
  if (!lib) throw new UploadError(409, "NO_LIBRARY", "You have no library to upload into");
  return lib.id;
}

// Register <root>/<userId> as a media source of the user so the worker
// watches it (the worker re-reads the source list every 30 s).
async function ensureUserSource(userId: string, userDir: string): Promise<void> {
  await db
    .insert(MediaPathTable)
    .values({ userId, path: userDir })
    .onConflictDoNothing();
}

export type UploadDestination = { id: string; name: string; path: string };

// Albums the user can upload into: the ones inside their uploads folder, their
// other library albums, then albums other people shared with them to add
// photos to (authz/album-contrib).
export async function listDestinations(userId: string): Promise<UploadDestination[]> {
  const root = await getUploadsRoot();
  if (!root) return [];
  const userDir = userDirFor(root, userId);
  const rows = await db
    .select({ id: AlbumTable.id, name: AlbumTable.name, dir: AlbumTable.dir })
    .from(AlbumTable)
    .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
    .where(eq(LibraryTable.userId, userId));
  const own = rows
    .filter((r) => isInside(userDir, r.dir))
    .map((r) => ({ id: r.id, name: r.name, path: relative(userDir, r.dir) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  // Library albums outside the uploads folder, by their folder path.
  const library = rows
    .filter((r) => !isInside(userDir, r.dir))
    .map((r) => ({ id: r.id, name: r.name, path: r.dir }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const shared = (await contributableAlbums(userId))
    .map((a) => ({ id: a.id, name: a.name, path: `${a.name} (shared by ${a.ownerName})` }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return [...own, ...library, ...shared];
}

// ---------- sessions ----------

export type CreateUploadInput = {
  userId: string;
  name: string;
  size: number;
  mime: string;
  albumId?: string | null | undefined;
  newAlbumName?: string | null | undefined;
  folder?: string | null | undefined;
  meta?: ImportMeta | null | undefined;
};

export type ImportMeta = {
  source: string;
  takenAt?: string | null | undefined;
  lat?: number | null | undefined;
  lon?: number | null | undefined;
  description?: string | null | undefined;
};

export async function createUpload(input: CreateUploadInput) {
  const root = await getUploadsRoot();
  if (!root) {
    throw new UploadError(412, "NO_UPLOAD_PATH", "Set an uploads location in Settings > Storage first");
  }
  const maxBytes = await getMaxUploadBytes();
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new UploadError(400, "BAD_SIZE", "The file is empty");
  }
  if (input.size > maxBytes) {
    throw new UploadError(413, "TOO_LARGE", `The file is larger than the ${formatBytes(maxBytes)} limit`);
  }
  // The browser's type is only a hint (the bytes are checked on finish), but
  // an obvious non-media file is refused before any bytes are sent.
  const mime = input.mime.toLowerCase();
  if (mime && !/^(image|video)\//.test(mime) && mime !== "application/octet-stream") {
    throw new UploadError(415, "NOT_MEDIA", "Only photos and videos can be uploaded");
  }
  const fileName = cleanSegment(input.name, 180) || "upload";

  const userDir = userDirFor(root, input.userId);
  let destDir: string;
  let albumId: string | null = null;
  if (input.albumId) {
    const [own] = await db
      .select({ id: AlbumTable.id, dir: AlbumTable.dir })
      .from(AlbumTable)
      .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
      .where(and(eq(AlbumTable.id, input.albumId), eq(LibraryTable.userId, input.userId)))
      .limit(1);
    // Else one of their library albums, or an album shared with them to add
    // photos to (any folder).
    const album =
      own && isInside(userDir, resolve(own.dir))
        ? own
        : await uploadableAlbum(input.userId, input.albumId);
    if (!album) {
      throw new UploadError(403, "BAD_ALBUM", "You cannot upload into that album");
    }
    destDir = resolve(album.dir);
    albumId = album.id;
  } else {
    const name = cleanAlbumName(input.newAlbumName ?? "") || DEFAULT_ALBUM_NAME;
    const folder = input.folder ? cleanAlbumName(input.folder) : "";
    destDir = folder ? join(userDir, folder, name) : join(userDir, name);
  }
  if (!albumId && !isInside(userDir, destDir)) {
    throw new UploadError(400, "BAD_ALBUM", "That album name is not allowed");
  }

  const [{ open } = { open: 0 }] = await db
    .select({ open: sql<number>`count(*)` })
    .from(UploadSessionTable)
    .where(and(eq(UploadSessionTable.userId, input.userId), eq(UploadSessionTable.status, "open")));
  if (open >= MAX_OPEN_SESSIONS) {
    throw new UploadError(429, "TOO_MANY", "Too many unfinished uploads. Finish or cancel some first");
  }

  const partDir = join(root, PARTIAL_DIR);
  try {
    await fsp.mkdir(partDir, { recursive: true });
    await fsp.mkdir(userDir, { recursive: true });
    await fsp.access(root, constants.W_OK);
  } catch {
    throw new UploadError(507, "NOT_WRITABLE", "The uploads location cannot be written to");
  }
  try {
    const fs = await fsp.statfs(root);
    if (fs.bavail * fs.bsize < input.size + FREE_SPACE_MARGIN) {
      throw new UploadError(507, "DISK_FULL", "Not enough free disk space for this file");
    }
  } catch (e) {
    if (e instanceof UploadError) throw e;
  }

  await ensureUserSource(input.userId, userDir);

  const [session] = await db
    .insert(UploadSessionTable)
    .values({
      userId: input.userId,
      fileName,
      size: input.size,
      mime: mime || "application/octet-stream",
      destDir,
      partPath: "",
      albumId,
      meta: input.meta ? JSON.stringify(input.meta) : null,
    })
    .returning();
  const partPath = join(partDir, `${session!.id}.part`);
  await fsp.writeFile(partPath, "");
  await db
    .update(UploadSessionTable)
    .set({ partPath })
    .where(eq(UploadSessionTable.id, session!.id));

  return {
    id: session!.id,
    fileName,
    received: 0,
    chunkBytes: CHUNK_BYTES,
  };
}

async function getOwnSession(id: string, userId: string): Promise<Session> {
  const [s] = await db
    .select()
    .from(UploadSessionTable)
    .where(and(eq(UploadSessionTable.id, id), eq(UploadSessionTable.userId, userId)))
    .limit(1);
  if (!s) throw new UploadError(404, "NOT_FOUND", "Upload not found. Start it again");
  return s;
}

async function bytesOnDisk(s: Session): Promise<number> {
  try {
    return Math.min((await fsp.stat(s.partPath)).size, s.size);
  } catch {
    return 0;
  }
}

export async function getUploadStatus(id: string, userId: string) {
  const s = await getOwnSession(id, userId);
  const received =
    s.status === "open" ? await bytesOnDisk(s) : s.status === "cancelled" ? 0 : s.size;
  return {
    id: s.id,
    status: s.status,
    size: s.size,
    received,
    fileId: s.fileId,
    albumId: s.albumId,
  };
}

// Caps the bytes one request may write.
function limiter(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > max) {
        cb(new UploadError(413, "CHUNK_TOO_LARGE", "The chunk runs past the end of the file"));
        return;
      }
      cb(null, chunk);
    },
  });
}

async function readHead(path: string, bytes: number): Promise<Buffer> {
  const fh = await fsp.open(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function discard(s: Session, status: "cancelled"): Promise<void> {
  await fsp.rm(s.partPath, { force: true }).catch(() => {});
  await db
    .update(UploadSessionTable)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(UploadSessionTable.id, s.id));
}

// Write one chunk at `offset`. The part file on disk is the truth: a chunk
// must start at or before its end (a client may resend the last chunk when the
// reply was lost), and anything after `offset` is replaced.
export async function writeChunk(opts: {
  id: string;
  userId: string;
  offset: number;
  body: Readable;
}): Promise<{ received: number; size: number }> {
  return withLock(opts.id, async () => {
    const s = await getOwnSession(opts.id, opts.userId);
    if (s.status !== "open") {
      throw new UploadError(409, "CLOSED", "This upload is already finished or cancelled");
    }
    const onDisk = await bytesOnDisk(s);
    if (!Number.isSafeInteger(opts.offset) || opts.offset < 0 || opts.offset > onDisk) {
      throw new UploadError(409, "BAD_OFFSET", "Offset does not match the bytes received", onDisk);
    }

    await fsp.truncate(s.partPath, opts.offset);
    const max = Math.min(s.size - opts.offset, MAX_CHUNK_BYTES);
    let failure: unknown = null;
    try {
      await pipeline(
        opts.body,
        limiter(max),
        createWriteStream(s.partPath, { flags: "r+", start: opts.offset }),
      );
    } catch (e) {
      failure = e;
    }

    const received = await bytesOnDisk(s);
    await db
      .update(UploadSessionTable)
      .set({ received, updatedAt: new Date().toISOString() })
      .where(eq(UploadSessionTable.id, s.id));

    // Refuse a non-media file after its first chunk, not after 2 GB.
    if (opts.offset === 0 && received >= Math.min(SNIFF_BYTES, s.size)) {
      const sniff = sniffMedia(await readHead(s.partPath, SNIFF_BYTES), s.fileName);
      if (!sniff.ok) {
        await discard(s, "cancelled");
        throw new UploadError(415, "NOT_MEDIA", sniff.reason);
      }
    }

    if (failure) {
      if (failure instanceof UploadError) throw new UploadError(failure.status, failure.code, failure.message, received);
      throw new UploadError(400, "INTERRUPTED", "The connection dropped. Resume the upload", received);
    }
    return { received, size: s.size };
  });
}

export async function cancelUpload(id: string, userId: string): Promise<void> {
  return withLock(id, async () => {
    const s = await getOwnSession(id, userId);
    if (s.status === "open") await discard(s, "cancelled");
  });
}

function hashFile(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => hash.update(c))
      .on("end", () => res(hash.digest("hex")))
      .on("error", rej);
  });
}

// Move the part file into the album folder without overwriting anything:
// link() fails with EEXIST when the name is taken, so two uploads of
// "IMG_0001.jpg" become "IMG_0001.jpg" and "IMG_0001 (1).jpg".
async function placeFile(partPath: string, destDir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? name : `${stem} (${i})${ext}`;
    const [row] = await db
      .select({ id: FileTable.id })
      .from(FileTable)
      .where(and(eq(FileTable.dir, destDir), eq(FileTable.name, candidate)))
      .limit(1);
    if (row) continue;
    const target = join(destDir, candidate);
    try {
      await fsp.link(partPath, target);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST") continue;
      // Another file system, or one without hard links: copy, still exclusive.
      try {
        await fsp.copyFile(partPath, target, constants.COPYFILE_EXCL);
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw e2;
      }
    }
    await fsp.rm(partPath, { force: true });
    return candidate;
  }
  throw new UploadError(409, "NAME_TAKEN", "Could not find a free file name");
}

// Same albums the scanner makes: one per folder from the user's uploads folder
// down to destDir (the uploads folder itself gets none). Returns destDir's id.
async function ensureAlbumChain(
  userDir: string,
  destDir: string,
  libraryId: string,
): Promise<{ albumId: string; created: boolean }> {
  const chain: string[] = [];
  for (let d = destDir; isInside(userDir, d); d = dirname(d)) chain.unshift(d);
  let parentId: string | null = null;
  let created = false;
  for (const dir of chain) {
    const [existing] = await db
      .select({ id: AlbumTable.id })
      .from(AlbumTable)
      .where(and(eq(AlbumTable.libraryId, libraryId), eq(AlbumTable.dir, dir)))
      .limit(1);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const inserted: { id: string }[] = await db
      .insert(AlbumTable)
      .values({ name: basename(dir), libraryId, dir, parentId })
      .onConflictDoNothing()
      .returning({ id: AlbumTable.id });
    const row = inserted[0];
    if (row) {
      created = true;
      parentId = row.id;
    } else {
      const [again] = await db
        .select({ id: AlbumTable.id })
        .from(AlbumTable)
        .where(and(eq(AlbumTable.libraryId, libraryId), eq(AlbumTable.dir, dir)))
        .limit(1);
      parentId = again?.id ?? null;
    }
  }
  if (!parentId) throw new Error(`No album for ${destDir}`);
  return { albumId: parentId, created };
}

// Same rows as files.create + libraryFile.create + albumFile.create, which the
// scanner calls for a new file. The worker's watcher sees the file a moment
// later, finds the row and skips it. A camera RAW uploaded next to its JPEG
// (same base name, same album) becomes the JPEG's hidden companion, in either
// order (utils/raw-pairing.ts). Returns the id of the photo that shows.
async function insertFileRows(opts: {
  dir: string;
  name: string;
  type: "image" | "video";
  mime: string;
  size: number;
  contentHash: string;
  libraryId: string;
  albumId: string;
}): Promise<string> {
  // Insert, link and demote commit together, under the face lock because a
  // demoted RAW's faces move to the JPEG; disk cleanup follows the commit.
  const fx = emptyRawEffects();
  const { fileId, pairs, motion } = await withFaceLock(async () => db.transaction((tx) => {
    const [file] = tx
      .insert(FileTable)
      .values({
        dir: opts.dir,
        name: opts.name,
        type: opts.type,
        mime: opts.mime,
        size: opts.size,
        contentHash: opts.contentHash,
      })
      .returning({ id: FileTable.id })
      .all();
    const fileId = file!.id;
    // Same connection, so this runs inside the transaction.
    const pairs = linkRawPairs([fileId]);
    // A Live Photo's video (or its still) arriving after the other half.
    const motion = pairs.companions.has(fileId)
      ? { companions: new Set<string>(), demoted: [], stillOf: new Map<string, string>() }
      : linkMotionPairs([fileId]);
    if (motion.companions.has(fileId)) {
      tx.insert(FileTaskTable).values(motionTaskRows(fileId)).run();
    } else if (!pairs.companions.has(fileId)) {
      tx.insert(FileTaskTable).values(fileTaskRows(fileId, opts.type)).run();
      tx.insert(LibraryFileTable).values({ fileId, libraryId: opts.libraryId }).run();
      tx.insert(AlbumFileTable).values({ fileId, albumId: opts.albumId }).run();
    }
    // The upload is a JPEG and its RAW was already here as a photo of its own.
    demoteRawFilesSync(pairs.primaryOf, pairs.demoted, fx);
    // The upload is a still and its video was already here as a video.
    demoteMotionFilesSync(motion.demoted, fx);
    return { fileId, pairs, motion };
  }));
  await finishRawMoves(fx);
  return pairs.primaryOf.get(fileId) ?? motion.stillOf.get(fileId) ?? fileId;
}

export type FinishResult = {
  status: "done" | "duplicate";
  fileId: string;
  albumId: string | null;
  name: string;
};

export async function finishUpload(id: string, userId: string): Promise<FinishResult> {
  return withLock(id, async () => {
    const s = await getOwnSession(id, userId);
    if (s.status === "done" || s.status === "duplicate") {
      return {
        status: s.status,
        fileId: s.fileId!,
        albumId: s.albumId,
        name: s.fileName,
      };
    }
    if (s.status !== "open") {
      throw new UploadError(409, "CLOSED", "This upload was cancelled");
    }
    const received = await bytesOnDisk(s);
    const actual = await fsp.stat(s.partPath).then((st) => st.size).catch(() => 0);
    if (received !== s.size || actual !== s.size) {
      throw new UploadError(409, "INCOMPLETE", "Not all bytes have arrived yet", received);
    }

    const sniff = sniffMedia(await readHead(s.partPath, SNIFF_BYTES), s.fileName);
    if (!sniff.ok) {
      await discard(s, "cancelled");
      throw new UploadError(415, "NOT_MEDIA", sniff.reason);
    }
    const m = sniff.media;

    // destDir was fixed when the upload started (<root>/<userId>/...). If the
    // admin moved the uploads location since, the file still goes there. An
    // upload into a shared album goes to that album's folder and the owner's
    // library; the share is checked again here, as it may be gone by now.
    const sessionUserDir = userDirOf(s.destDir, userId);
    const shared =
      !sessionUserDir && s.albumId ? await uploadableAlbum(userId, s.albumId) : null;
    if (!sessionUserDir && !(shared && resolve(shared.dir) === s.destDir)) {
      throw new UploadError(403, "BAD_ALBUM", "You can no longer upload into that album");
    }
    // Duplicates are looked for in the library the file goes into.
    const dupeScope = shared
      ? eq(LibraryFileTable.libraryId, shared.libraryId)
      : eq(LibraryTable.userId, userId);

    const contentHash = await hashFile(s.partPath);
    const [dupe] = await db
      .select({ id: FileTable.id, albumId: AlbumFileTable.albumId })
      .from(FileTable)
      .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
      .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
      .leftJoin(AlbumFileTable, eq(AlbumFileTable.fileId, FileTable.id))
      .where(and(eq(FileTable.contentHash, contentHash), dupeScope))
      .limit(1);
    // The same RAW may already be here as the hidden companion of a photo:
    // that photo is the duplicate.
    const rawPrimary = alias(FileTable, "raw_primary");
    const [rawDupe] = dupe
      ? []
      : await db
          .select({ id: rawPrimary.id, albumId: AlbumFileTable.albumId })
          .from(FileTable)
          .innerJoin(rawPrimary, eq(rawPrimary.rawFileId, FileTable.id))
          .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, rawPrimary.id))
          .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
          .leftJoin(AlbumFileTable, eq(AlbumFileTable.fileId, rawPrimary.id))
          .where(and(eq(FileTable.contentHash, contentHash), dupeScope))
          .limit(1);
    const existing = dupe ?? rawDupe;
    if (existing) {
      await fsp.rm(s.partPath, { force: true });
      await db
        .update(UploadSessionTable)
        .set({
          status: "duplicate",
          fileId: existing.id,
          albumId: existing.albumId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(UploadSessionTable.id, s.id));
      return { status: "duplicate", fileId: existing.id, albumId: existing.albumId, name: s.fileName };
    }

    let libraryId: string;
    let albumId: string;
    let name: string;
    if (shared) {
      // The shared album's folder already exists; nothing is created above it.
      name = await placeFile(s.partPath, s.destDir, finalFileName(s.fileName, m));
      inheritOwner(join(s.destDir, name));
      libraryId = shared.libraryId;
      albumId = shared.id;
    } else {
      await fsp.mkdir(s.destDir, { recursive: true });
      // A symlink inside the uploads folder must not lead the file out of it.
      const realDest = await fsp.realpath(s.destDir);
      const realUser = await fsp.realpath(sessionUserDir!);
      if (!isInside(realUser, realDest)) {
        throw new UploadError(400, "BAD_ALBUM", "Bad destination");
      }
      name = await placeFile(s.partPath, s.destDir, finalFileName(s.fileName, m));
      libraryId = await getDefaultLibraryId(userId);
      const chain = await ensureAlbumChain(sessionUserDir!, s.destDir, libraryId);
      albumId = chain.albumId;
      if (chain.created) clearScopeCache();
    }

    let fileId: string;
    try {
      fileId = await insertFileRows({
        dir: s.destDir,
        name,
        type: m.type,
        mime: m.mime,
        size: s.size,
        contentHash,
        libraryId,
        albumId,
      });
    } catch (e) {
      // The watcher imported it first: use its row.
      const [row] = await db
        .select({ id: FileTable.id })
        .from(FileTable)
        .where(and(eq(FileTable.dir, s.destDir), eq(FileTable.name, name)))
        .limit(1);
      if (!row) throw e;
      fileId = primaryOfRaw(row.id) ?? row.id;
    }

    await db
      .update(UploadSessionTable)
      .set({
        status: "done",
        fileId,
        albumId,
        received: s.size,
        fileName: name,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(UploadSessionTable.id, s.id));

    if (s.meta) await applyImportMeta(fileId, s.meta);

    // A bare "something changed" signal (no ids): see ws-manager.ts.
    wsManager.broadcast("upload:finished", null);
    logger.info(`[upload] ${join(s.destDir, name)} (${s.size} bytes)`);
    return { status: "done", fileId, albumId, name };
  });
}

// Keep an import's metadata (e.g. a Google Takeout JSON sidecar) and use it
// now for what the file lacks: the date (imageMetadata.save also falls back to
// it when the EXIF has none) and the position (the geo worker replaces it
// when the file has its own GPS).
async function applyImportMeta(fileId: string, raw: string): Promise<void> {
  let meta: ImportMeta;
  try {
    meta = JSON.parse(raw) as ImportMeta;
  } catch {
    return;
  }
  const hasGeo =
    meta.lat != null && meta.lon != null && !(meta.lat === 0 && meta.lon === 0);
  await db
    .insert(FileImportMetaTable)
    .values({
      fileId,
      source: meta.source,
      takenAt: meta.takenAt ?? null,
      lat: hasGeo ? meta.lat! : null,
      lon: hasGeo ? meta.lon! : null,
      description: meta.description?.trim() || null,
    })
    .onConflictDoNothing();
  if (meta.takenAt) {
    await db
      .update(FileTable)
      .set({ takenAt: meta.takenAt })
      .where(and(eq(FileTable.id, fileId), isNull(FileTable.takenAt)));
  }
  if (hasGeo) {
    await db
      .insert(GeoLocationTable)
      .values({ fileId, lat: meta.lat!, lon: meta.lon! })
      .onConflictDoNothing();
  }
}

// Remove uploads nobody touched for a day, old finished rows, and part files
// that have no open session (for example after a crash).
export async function cleanupStaleUploads(now = Date.now()): Promise<number> {
  const openCutoff = new Date(now - STALE_OPEN_MS).toISOString();
  const closedCutoff = new Date(now - STALE_CLOSED_MS).toISOString();
  let removed = 0;

  const stale = await db
    .select()
    .from(UploadSessionTable)
    .where(and(eq(UploadSessionTable.status, "open"), lt(UploadSessionTable.updatedAt, openCutoff)));
  for (const s of stale) {
    if (busy.has(s.id)) continue;
    await fsp.rm(s.partPath, { force: true }).catch(() => {});
    removed++;
  }
  if (stale.length) {
    await db.delete(UploadSessionTable).where(
      inArray(
        UploadSessionTable.id,
        stale.filter((s) => !busy.has(s.id)).map((s) => s.id),
      ),
    );
  }
  await db
    .delete(UploadSessionTable)
    .where(and(ne(UploadSessionTable.status, "open"), lt(UploadSessionTable.updatedAt, closedCutoff)));

  const root = await getUploadsRoot();
  if (root) {
    const partDir = join(root, PARTIAL_DIR);
    let names: string[] = [];
    try {
      names = await fsp.readdir(partDir);
    } catch {}
    if (names.length) {
      const open = new Set(
        (
          await db
            .select({ id: UploadSessionTable.id })
            .from(UploadSessionTable)
            .where(eq(UploadSessionTable.status, "open"))
        ).map((r) => r.id),
      );
      for (const n of names) {
        const id = n.endsWith(".part") ? n.slice(0, -5) : n;
        if (open.has(id) || busy.has(id)) continue;
        const p = join(partDir, n);
        try {
          const st = await fsp.stat(p);
          if (now - st.mtimeMs < STALE_OPEN_MS) continue;
          await fsp.rm(p, { force: true });
          removed++;
        } catch {}
      }
    }
  }
  return removed;
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startUploadCleanup(): void {
  if (cleanupTimer) return;
  const run = () =>
    cleanupStaleUploads()
      .then((n) => {
        if (n > 0) logger.info(`[upload] removed ${n} stale partial upload(s)`);
      })
      .catch((e) => logger.warn("[upload] cleanup failed", e as Error));
  setTimeout(run, 60_000).unref();
  cleanupTimer = setInterval(run, 60 * 60 * 1000);
  cleanupTimer.unref();
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${units[i]}`;
}
