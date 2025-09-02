import { lookup as mimeLookup } from 'mime-types';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { logger } from './logger.js';
import { type RouterInputs, trpc } from './trpc.js';

type MediaType = 'image' | 'video';

const imageExt = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']);
const videoExt = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv']);
const allowed = new Set([...imageExt, ...videoExt]);

function getMediaType(ext: string): MediaType | null {
  if (imageExt.has(ext)) return 'image';
  if (videoExt.has(ext)) return 'video';
  return null;
}

function getFullPath(file: TempFile) {
  return join(file.dir, file.name);
}

type CreateFilesInput = RouterInputs['files']['create'];
type TempFile = CreateFilesInput[0];

export async function scan(rootDir: string, userId: string) {
  if (!existsSync(rootDir)) {
    logger.warn(`Scan skipped, path not found: ${rootDir}`);
    return { folders: [], totalFiles: 0, byFolder: new Map<string, TempFile[]>() };
  }

  const folders: string[] = [];
  const byFolder = new Map<string, TempFile[]>();

  function walk(dir: string) {
    folders.push(dir);
    let entries: import('node:fs').Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch (error) {
      logger.warn(`Failed to read directory, skipping: ${dir}`);
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(path);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = extname(entry.name).slice(1).toLowerCase();
      if (!allowed.has(ext)) continue;

      const type = getMediaType(ext);
      if (!type) continue;

      let stats: import('node:fs').Stats;
      try {
        stats = statSync(path);
      } catch {
        logger.warn(`Failed to stat file, skipping: ${path}`);
        continue;
      }

      const mime = mimeLookup(ext) || (type === 'image' ? 'image/*' : 'video/*');
      const arr: TempFile[] = byFolder.get(dir) ?? [];
      arr.push({ name: entry.name, dir, mime, size: stats.size, type });
      byFolder.set(dir, arr);
    }
  }

  walk(rootDir);

  async function ensureAlbumForDir(dir: string, libraryId: string): Promise<string | null> {
    if (!dir || dir === dirname(dir)) return null;

    const [existing] = await trpc.album.getAlbumByDir.query(dir);
    if (existing?.id) return existing.id;

    const albumName = basename(dir);
    if (!albumName) return null;

    const parentDir = dirname(dir);
    const parentId =
      parentDir && parentDir !== dir && parentDir.startsWith(rootDir)
        ? await ensureAlbumForDir(parentDir, libraryId)
        : null;

    await trpc.album.create.mutate({
      userId,
      album: { name: albumName, libraryId, dir, parentId },
    });

    logger.info(`Album created: ${dir} (parent: ${parentDir})`);
    const [created] = await trpc.album.getAlbumByDir.query(dir);
    return created?.id ?? null;
  }

  const normalizedRoot = rootDir.replace(/\\/g, '/');
  const libraryId = await trpc.library.getDefaultLibraryIdForUser.query(userId);

  for (const folder of folders) {
    const files = byFolder.get(folder) ?? [];
    const alreadySavedFiles = await trpc.files.getFilesInDir.mutate(folder);
    const alreadySavedPaths = new Set(alreadySavedFiles.map(getFullPath));

    logger.info(
      `Processing folder: ${folder} (${files.length} files, ${alreadySavedFiles.length} already saved)`,
    );

    // Skip completely empty folders
    if (files.length === 0 && alreadySavedFiles.length === 0) {
      logger.info(`Skipping empty folder: ${folder}`);
      continue;
    }

    // Remove orphaned files
    if (files.length === 0 && alreadySavedFiles.length > 0) {
      logger.info(`Removing orphaned files for folder: ${folder}`);
      await trpc.files.removeFilesById.mutate(alreadySavedFiles.map((f) => f.id));
      await trpc.albumFile.removeAlbumFilesById.mutate(alreadySavedFiles.map((f) => f.id));
      await trpc.libraryFile.removeLibraryFilesById.mutate(alreadySavedFiles.map((f) => f.id));
      continue;
    }

    // Remove files that exist in DB but no longer on disk
    const pathsOnDisk = new Set(files.map(getFullPath));
    const orphanedFiles = alreadySavedFiles.filter((f) => !pathsOnDisk.has(getFullPath(f)));
    if (orphanedFiles.length > 0) {
      logger.info(`Removing ${orphanedFiles.length} orphaned files for folder: ${folder}`);
      await trpc.files.removeFilesById.mutate(orphanedFiles.map((f) => f.id));
      await trpc.albumFile.removeAlbumFilesById.mutate(orphanedFiles.map((f) => f.id));
      await trpc.libraryFile.removeLibraryFilesById.mutate(orphanedFiles.map((f) => f.id));
    }

    // Filter new files
    const filesToAdd: CreateFilesInput = files
      .filter((f) => !alreadySavedPaths.has(getFullPath(f)))
      .map((f) => ({ dir: folder, type: f.type, mime: f.mime, name: f.name, size: f.size }));

    if (!filesToAdd.length) {
      logger.info(`No new files to add for folder: ${folder}`);
      continue;
    }

    logger.info(`Adding ${filesToAdd.length} new files for folder: ${folder}`);
    const fileCreateResult = await trpc.files.create.mutate(filesToAdd);

    // Link files to library
    await trpc.libraryFile.create.mutate(
      fileCreateResult.map((f) => ({ fileId: f.id, libraryId })),
    );

    // Ensure album exists and link files
    const ensuredAlbumId = await ensureAlbumForDir(folder, libraryId);
    if (ensuredAlbumId) {
      logger.info(`Linking ${fileCreateResult.length} files to album: ${folder}`);
      await trpc.albumFile.create.mutate(
        fileCreateResult.map((f) => ({ fileId: f.id, albumId: ensuredAlbumId })),
      );
    }
  }

  const total = Array.from(byFolder.values()).reduce((n, a) => n + a.length, 0);
  return { folders, totalFiles: total, byFolder };
}
