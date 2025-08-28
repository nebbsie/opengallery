import { lookup as mimeLookup } from 'mime-types';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
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
        dir: entry.parentPath,
        mime,
        size: stats.size,
        type,
      });
      byFolder.set(dir, arr);
    }
  }

  walk(rootDir);

  for (const folder of folders) {
    // Get all the files in this folder.
    const files = byFolder.get(folder) ?? [];

    // Get all the files already in the database for this folder.
    const alreadySavedFiles = await trpc.files.getFilesInDir.mutate(folder);
    const alreadySavedPaths = new Set(alreadySavedFiles.map(getFullPath));

    logger.info(
      `Processing folder: ${folder} (${files.length} files) (already saved: ${alreadySavedFiles.length})`,
    );

    // If no files to add and no files in the DB for this folder, skip.
    if (files.length === 0 && alreadySavedFiles.length === 0) {
      logger.info(`Skipping folder (no files): ${folder}`);
      continue;
    }

    // If no files to add but there are files in the DB for this folder, remove them.
    if (files.length === 0) {
      logger.info(`Removing orphaned files for folder: ${folder}`);
      await trpc.files.removeFilesById.mutate(alreadySavedFiles.map((f: { id: string }) => f.id));
      continue;
    }

    // If a file is in the DB but not on disk, remove it from the DB.
    const pathsOnDisk = new Set(files.map(getFullPath));
    const orphanedFiles = alreadySavedFiles.filter((f) => !pathsOnDisk.has(getFullPath(f)));
    if (orphanedFiles.length > 0) {
      logger.info(`Removing ${orphanedFiles.length} orphaned files for folder: ${folder}`);
      await trpc.files.removeFilesById.mutate(orphanedFiles.map((f: { id: string }) => f.id));
    }

    // Filter out files that are already in the database.
    const filesToAdd: CreateFilesInput = files
      .filter((f) => !alreadySavedPaths.has(getFullPath(f)))
      .map((f) => ({
        dir: folder,
        type: f.type,
        mime: f.mime,
        name: f.name,
        size: f.size,
      }));

    if (!filesToAdd.length) {
      logger.info(`No new files to add for folder: ${folder}`);
      continue;
    }

    logger.info(`Adding ${filesToAdd.length} new files for folder: ${folder}`);

    // Actually add all new files that aren't already in the DB.
    const fileCreateResult = await trpc.files.create.mutate(filesToAdd);

    // Get the user's default library.
    const libraryId = await trpc.library.getDefaultLibraryIdForUser.query(userId);

    // Link each new file to the library.
    await trpc.libraryFile.create.mutate(
      fileCreateResult.map(({ id }) => ({
        fileId: id,
        libraryId,
      })),
    );
  }

  const total = Array.from(byFolder.values()).reduce((n, a) => n + a.length, 0);

  return { folders, totalFiles: total, byFolder };
}
