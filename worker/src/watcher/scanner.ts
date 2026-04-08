import { lookup as mimeLookup } from 'mime-types';
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { computeFileHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { ALLOWED_EXTENSIONS, type MediaType, getMediaType } from '../utils/media-types.js';
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

  const skipAlbumFor = options?.skipAlbumFor ?? rootDir;
  const skipAlbumForHostPath = toHostPath(skipAlbumFor);

  // Async recursive directory walk - non-blocking
  async function walk(dir: string): Promise<void> {
    folders.push(dir);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch (error) {
      logger.warn(`Failed to read directory during scan, skipping: ${dir}`);
      return;
    }

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

    for (const result of statResults) {
      if (result.status === 'rejected') {
        continue; // Skip files that failed to stat
      }
      const { entry, ext, type, stats } = result.value;
      const mime = mimeLookup(ext) || (type === 'image' ? 'image/*' : 'video/*');

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
    const alreadySavedFiles = (await trpc.files.getFilesInDir.mutate(toHostPath(folder))) as Array<{
      id: string;
      dir: string;
      name: string;
    }>;
    const alreadySavedPaths = new Set(alreadySavedFiles.map((f) => getFullPath(f.dir, f.name)));

    // If no files to add and no files in the DB for this folder, skip.
    if (files.length === 0 && alreadySavedFiles.length === 0) {
      logger.info(`Skipping folder (no files): ${folder}`);
      continue;
    }

    // If no files to add but there are files in the DB for this folder, remove them.
    if (files.length === 0) {
      logger.info(`Removing orphaned files for folder: ${folder}`);
      await trpc.files.removeFilesById.mutate(alreadySavedFiles.map((f: { id: string }) => f.id));

      //here we should really delete them everywhere if not found on disk
      //albumFile, LibraryFile too due to foreign key constraints in db
      await trpc.albumFile.removeAlbumFilesById.mutate(
        alreadySavedFiles.map((f: { id: string }) => f.id),
      );
      await trpc.libraryFile.removeLibraryFilesById.mutate(
        alreadySavedFiles.map((f: { id: string }) => f.id),
      );

      continue;
    }

    // If a file is in the DB but not on disk, remove it from the DB.
    const pathsOnDisk = new Set(files.map((f) => getFullPath(f.dir, f.name)));
    const orphanedFiles = alreadySavedFiles.filter((f) => !pathsOnDisk.has(getFullPath(f.dir, f.name)));
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

    // Actually add all new files that aren't already in the DB.
    const fileCreateResult = (await trpc.files.create.mutate(filesToAdd)) as Array<{
      id: string;
      dir: string;
      name: string;
    }>;

    // Get the user's default library.
    const libraryId = await trpc.library.getDefaultLibraryIdForUser.query(userId);

    // Link each new file to the library.
    await trpc.libraryFile.create.mutate(
      fileCreateResult.map(({ id }) => ({
        fileId: id,
        libraryId,
      })),
    );

    //check if file is linked to an album based on album dir == file dir
    //if not album, generate one first for this folder dir
    await trpc.album.getAlbumByDir.query(toHostPath(folder));

    // Ensure album exists for this folder (this will also ensure parents exist)
    if (toHostPath(folder) !== skipAlbumForHostPath) {
      const ensuredAlbumId = await ensureAlbumForDir(toHostPath(folder), libraryId);
      if (ensuredAlbumId) {
        logger.info(`Album ensured for folder: ${folder}`);
      }
    }

    //this may need to be changed to get all users library files(if in future they could have many), not just default library files.
    //library is what links a file to a user
    const allFiles = (await trpc.libraryFile.getAllLibraryFiles.query(libraryId)) as Array<{
      id: string;
      dir: string;
    }>;
    const albums = (await trpc.album.getAllAlbumsForLibrary.query(libraryId)) as Array<{
      id: string;
      dir: string;
    }>;

    const albumFiles = (await trpc.albumFile.getByAlbumIds.query(
      albums.map((f: { id: string }) => f.id),
    )) as Array<{ albumId: string; fileId: string }>;

    // Build a lookup table: album name → albumId
    const albumMap = new Map(albums.map((a) => [a.dir, a.id]));

    // Build lookup: albumId → Set<fileId>
    const existingLinks = new Map<string, Set<string>>();
    for (const af of albumFiles) {
      if (!existingLinks.has(af.albumId)) {
        existingLinks.set(af.albumId, new Set());
      }
      existingLinks.get(af.albumId)!.add(af.fileId);
    }

    // Collect new links
    const albumFilesToInsert = allFiles.flatMap((file) => {
      const albumId = albumMap.get(file.dir);
      if (!albumId) return [];

      const alreadyLinked = existingLinks.get(albumId)?.has(file.id);
      return alreadyLinked ? [] : [{ fileId: file.id, albumId }];
    });

    if (albumFilesToInsert.length > 0) {
      await trpc.albumFile.create.mutate(albumFilesToInsert);
      logger.info(`Linking album files for folder: ${folder}`);
    }
  }

  const total = Array.from(byFolder.values()).reduce((n, a) => n + a.length, 0);

  return { folders, totalFiles: total, byFolder };
}
