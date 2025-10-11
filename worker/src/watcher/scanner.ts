import { lookup as mimeLookup } from 'mime-types';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { withConcurrency } from '../utils/concurrency.js';
import { logger } from '../utils/logger.js';
import { type RouterInputs, trpc } from '../utils/trpc.js';

type MediaType = 'image' | 'video';

const imageExt = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']);
const videoExt = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv']);
const allowed = new Set([...imageExt, ...videoExt]);

function getMediaType(ext: string): MediaType | null {
  if (imageExt.has(ext)) return 'image';
  if (videoExt.has(ext)) return 'video';
  return null;
}

function getFullPath(file: { dir: string; name: string }) {
  return join(file.dir, file.name);
}

type CreateFilesInput = RouterInputs['files']['create'];

type TempFile = CreateFilesInput[0];

export async function scan(rootDir: string, userId: string, options?: { skipAlbumFor?: string }) {
  const containerRootPrefix = process.env['HOST_ROOT_PREFIX'];
  const toHostPath = (p: string) =>
    containerRootPrefix && p.startsWith(containerRootPrefix)
      ? p.slice(containerRootPrefix.length) || '/'
      : p;
  if (!existsSync(rootDir)) {
    logger.warn(`Scan skipped, path not found: ${rootDir}`);
    return { folders: [], totalFiles: 0, byFolder: new Map<string, TempFile[]>() };
  }

  const folders: string[] = [];
  const byFolder = new Map<string, TempFile[]>();

  const skipAlbumFor = options?.skipAlbumFor ?? rootDir;

  function walk(dir: string) {
    folders.push(dir);
    let entries: import('node:fs').Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch (error) {
      logger.warn(`Failed to read directory during scan, skipping: ${dir}`);
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);

      // If directory, recurse.
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }

      // If not a file, skip.
      if (!entry.isFile()) {
        continue;
      }

      const ext = extname(entry.name).slice(1).toLowerCase();
      if (!allowed.has(ext)) {
        continue;
      }

      const type = getMediaType(ext);
      if (!type) {
        continue;
      }

      let stats: import('node:fs').Stats;
      try {
        stats = statSync(path);
      } catch (error) {
        logger.warn(`Failed to stat file during scan, skipping: ${path}`);
        continue;
      }

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
  }

  walk(rootDir);

  // Helper to ensure an album (and its parent chain) exists for a directory
  async function ensureAlbumForDir(dir: string, libraryId: string): Promise<string | null> {
    if (!dir || dir === skipAlbumFor) return null;

    const [existing] = await trpc.album.getAlbumByDir.query(dir);
    if (existing && existing.id) return existing.id;

    const albumName = basename(dir);
    if (!albumName) return null;

    const parentDir = dirname(dir);
    const parentId =
      parentDir && parentDir !== dir ? await ensureAlbumForDir(parentDir, libraryId) : null;

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
    const alreadySavedPaths = new Set(alreadySavedFiles.map(getFullPath));

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
    const pathsOnDisk = new Set(files.map(getFullPath));
    const orphanedFiles = alreadySavedFiles.filter((f) => !pathsOnDisk.has(getFullPath(f)));
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
    const filesToAdd: CreateFilesInput = files
      .filter((f) => !alreadySavedPaths.has(getFullPath(f)))
      .map((f) => ({
        dir: toHostPath(folder),
        type: f.type,
        mime: f.mime,
        name: f.name,
        size: f.size,
      }));

    if (!filesToAdd.length) {
      continue;
    }

    logger.info(`Adding ${filesToAdd.length} new files for folder: ${folder}`);

    // Actually add all new files that aren't already in the DB.
    const fileCreateResult = (await withConcurrency(() =>
      trpc.files.create.mutate(filesToAdd),
    )) as Array<{
      id: string;
      dir: string;
      name: string;
    }>;

    // Get the user's default library.
    const libraryId = await trpc.library.getDefaultLibraryIdForUser.query(userId);

    // Link each new file to the library.
    await withConcurrency(() =>
      trpc.libraryFile.create.mutate(
        fileCreateResult.map(({ id }) => ({
          fileId: id,
          libraryId,
        })),
      ),
    );

    //check if file is linked to an album based on album dir == file dir
    //if not album, generate one first for this folder dir
    await withConcurrency(() => trpc.album.getAlbumByDir.query(toHostPath(folder)));

    const skipAlbumFor = options?.skipAlbumFor ?? rootDir;
    // Ensure album exists for this folder (this will also ensure parents exist)
    if (folder !== skipAlbumFor) {
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
