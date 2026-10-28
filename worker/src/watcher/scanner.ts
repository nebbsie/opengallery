import { lookup as mimeLookup } from 'mime-types';
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { computeFileHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { ALLOWED_EXTENSIONS, type MediaType, getMediaType, rawMime } from '../utils/media-types.js';
import { getFullPath, toHostPath } from '../utils/paths.js';
import { type RouterInputs, trpc } from '../utils/trpc.js';
import { throttleIo } from '../utils/io-throttle.js';

// Folders to exclude from scanning (encoding/storage folders)
const EXCLUDED_SCAN_FOLDERS = new Set(['uploads', 'variants', 'encodes']);

type CreateFilesInput = RouterInputs['files']['create'];

type TempFile = CreateFilesInput[0];

export async function scan(rootDir: string, userId: string, options?: { skipAlbumFor?: string }) {
  if (!existsSync(rootDir)) {
    logger.warn(`Scan skipped, path not found: ${rootDir}`);
    return { folders: [], totalFiles: 0, byFolder: new Map<string, TempFile[]>() };
  }

  const folders: string[] = [];
  const byFolder = new Map<string, TempFile[]>();
  // Host paths of files that were listed but could not be stat'd. The media
  // drive sits on a flaky USB bridge, so a transient EIO/ENOENT must never be
  // read as "deleted from disk".
  const unreadablePaths = new Set<string>();
  let rootEmpty = false;

  const skipAlbumFor = options?.skipAlbumFor ?? rootDir;
  const skipAlbumForHostPath = toHostPath(skipAlbumFor);

  // Async recursive directory walk - non-blocking
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch (error) {
      // Not added to `folders`: an unreadable dir must not be reconciled as
      // empty, or every file in it would be removed from the DB.
      logger.warn(`Failed to read directory during scan, skipping: ${dir}`);
      return;
    }
    folders.push(dir);
    if (dir === rootDir && entries.length === 0) rootEmpty = true;

    // Collect subdirectories to process
    const subdirs: string[] = [];
    const filesToStat: Array<{ entry: import('node:fs').Dirent; path: string; ext: string; type: MediaType }> = [];

    for (const entry of entries) {
      const path = join(dir, entry.name);

      // If directory, add to queue for recursion (skip excluded folders)
      if (entry.isDirectory()) {
        if (EXCLUDED_SCAN_FOLDERS.has(entry.name)) {
          logger.debug(`Skipping excluded folder: ${path}`);
          continue;
        }
        subdirs.push(path);
        continue;
      }

      // If not a file, skip
      if (!entry.isFile()) {
        continue;
      }

      const ext = extname(entry.name).slice(1).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        continue;
      }

      const type = getMediaType(ext);
      if (!type) {
        continue;
      }

      filesToStat.push({ entry, path, ext, type });
    }

    // Stat all files in parallel for this directory
    const statResults = await Promise.allSettled(
      filesToStat.map(async ({ entry, path, ext, type }) => {
        const stats = await stat(path);
        return { entry, path, ext, type, stats };
      })
    );

    for (const [i, result] of statResults.entries()) {
      if (result.status === 'rejected') {
        // Skip files that failed to stat, but keep their DB rows.
        unreadablePaths.add(getFullPath(toHostPath(dir), filesToStat[i]!.entry.name));
        continue;
      }
      const { entry, ext, type, stats } = result.value;
      const mime = rawMime(ext) || mimeLookup(ext) || (type === 'image' ? 'image/*' : 'video/*');

      const arr: TempFile[] = byFolder.get(dir) ?? [];
      arr.push({
        name: entry.name,
        // Store host-style path in DB
        dir: toHostPath(dir),
        mime,
        size: stats.size,
        type,
      });
      byFolder.set(dir, arr);
    }

    // Recurse into subdirectories (sequentially to avoid too many open handles)
    for (const subdir of subdirs) {
      await walk(subdir);
    }
  }

  await walk(rootDir);

  // Ensure an album (and its parent chain) exists for a directory
  async function ensureAlbumForDir(dir: string, libraryId: string): Promise<string | null> {
    if (!dir || dir === skipAlbumForHostPath) return null;

    const [existing] = await trpc.album.getAlbumByDir.query(dir);
    if (existing && existing.id) return existing.id;

    const albumName = basename(dir);
    if (!albumName) return null;

    const parentDir = dirname(dir);
    const parentId =
      parentDir && parentDir !== dir && parentDir.startsWith(skipAlbumForHostPath)
        ? await ensureAlbumForDir(parentDir, libraryId)
        : null;

    await trpc.album.create.mutate({
      userId,
      album: {
        name: albumName,
        libraryId,
        dir,
        parentId,
      },
    });

    const [created] = await trpc.album.getAlbumByDir.query(dir);
    return created?.id ?? null;
  }

  for (const folder of folders) {
    //at this level, we are looping through a specifc users given source paths.

    // Get all the files in this folder.
    const files = byFolder.get(folder) ?? [];

    // Get all the files already in the database for this folder.
    const alreadySavedFiles = (await trpc.files.getFilesInDir.query(toHostPath(folder))) as Array<{
      id: string;
      dir: string;
      name: string;
      size: number;
      contentHash: string | null;
    }>;
    const alreadySavedPaths = new Set(alreadySavedFiles.map((f) => getFullPath(f.dir, f.name)));

    // If no files to add and no files in the DB for this folder, skip.
    if (files.length === 0 && alreadySavedFiles.length === 0) {
      logger.info(`Skipping folder (no files): ${folder}`);
      continue;
    }

    // If a file is in the DB but not on disk, remove it from the DB. Skipped
    // when the root listed as empty: that is what an unmounted mountpoint looks
    // like, and treating it as "all files deleted" would wipe the library.
    const pathsOnDisk = new Set(files.map((f) => getFullPath(f.dir, f.name)));
    const orphanedFiles = rootEmpty
      ? []
      : alreadySavedFiles.filter((f) => {
          const p = getFullPath(f.dir, f.name);
          return !pathsOnDisk.has(p) && !unreadablePaths.has(p);
        });
    if (orphanedFiles.length > 0) {
      logger.info(`Removing ${orphanedFiles.length} orphaned files for folder: ${folder}`);
      await trpc.files.removeFilesById.mutate(orphanedFiles.map((f: { id: string }) => f.id));

      //here we should really delete them everywhere if not found on disk
      //albumFile, LibraryFile too due to foreign key constraints in db
      await trpc.albumFile.removeAlbumFilesById.mutate(
        orphanedFiles.map((f: { id: string }) => f.id),
      );
      await trpc.libraryFile.removeLibraryFilesById.mutate(
        orphanedFiles.map((f: { id: string }) => f.id),
      );
    }

    // Heal files whose content changed while the watcher was down (D4). A size
    // mismatch is a cheap proxy for "the file was replaced"; confirm with a hash
    // and re-process only those that actually changed (avoids hashing the whole
    // library on every scan).
    const onDiskByPath = new Map(files.map((f) => [getFullPath(f.dir, f.name), f]));
    for (const saved of alreadySavedFiles) {
      const onDisk = onDiskByPath.get(getFullPath(saved.dir, saved.name));
      if (!onDisk || onDisk.size === saved.size) continue;

      const filePath = join(folder, saved.name);
      let contentHash: string | undefined;
      try {
        contentHash = await throttleIo(() => computeFileHash(filePath));
      } catch (err) {
        logger.warn(`Failed to compute hash for changed file ${filePath}: ${err}`);
        continue;
      }
      if (saved.contentHash && saved.contentHash === contentHash) continue;

      await trpc.files.refreshChangedFile.mutate({
        fileId: saved.id,
        size: onDisk.size,
        contentHash,
      });
      logger.info(`Re-processing changed file on scan: ${filePath}`);
    }

    // Filter out files that are already in the database.
    const newFiles = files.filter((f) => !alreadySavedPaths.has(getFullPath(f.dir, f.name)));

    if (!newFiles.length) {
      continue;
    }

    logger.info(`Adding ${newFiles.length} new files for folder: ${folder}`);

    // Compute content hashes for new files (for deduplication)
    const filesToAdd: CreateFilesInput = await Promise.all(
      newFiles.map(async (f) => {
        const filePath = join(folder, f.name);
        let contentHash: string | undefined;
        try {
          contentHash = await throttleIo(() => computeFileHash(filePath));
        } catch (err) {
          logger.warn(`Failed to compute hash for ${filePath}: ${err}`);
        }
        return {
          dir: toHostPath(folder),
          type: f.type,
          mime: f.mime,
          name: f.name,
          size: f.size,
          contentHash,
        };
      }),
    );

    // Actually add all new files that aren't already in the DB. A camera RAW
    // next to its JPEG comes back as a hidden companion of the JPEG: it gets no
    // library or album link of its own.
    const created = (await trpc.files.create.mutate(filesToAdd)) as Array<{
      id: string;
      dir: string;
      name: string;
      rawCompanion?: boolean;
    }>;
    const fileCreateResult = created.filter((f) => !f.rawCompanion);
    if (created.length > fileCreateResult.length) {
      logger.info(
        `Paired ${created.length - fileCreateResult.length} RAW file(s) with their JPEG in folder: ${folder}`,
      );
    }
    if (!fileCreateResult.length) continue;

    // Get the user's default library.
    const libraryId = await trpc.library.getDefaultLibraryIdForUser.query(userId);

    // Link each new file to the library.
    await trpc.libraryFile.create.mutate(
      fileCreateResult.map(({ id }) => ({
        fileId: id,
        libraryId,
      })),
    );

    // Ensure an album exists for this folder (and its parent chain), then link
    // just the files we created in this folder. Previously this reloaded the
    // entire library (files + albums + album-files) for every folder, making
    // initial import O(folders × library) (D5); the new files all live in this
    // folder's dir, so there's nothing else to link here.
    if (toHostPath(folder) !== skipAlbumForHostPath) {
      const albumId = await ensureAlbumForDir(toHostPath(folder), libraryId);
      if (albumId) {
        await trpc.albumFile.create.mutate(
          fileCreateResult.map(({ id }) => ({ fileId: id, albumId })),
        );
        logger.info(`Linking ${fileCreateResult.length} album file(s) for folder: ${folder}`);
      }
    }
  }

  const total = Array.from(byFolder.values()).reduce((n, a) => n + a.length, 0);

  return { folders, totalFiles: total, byFolder };
}
