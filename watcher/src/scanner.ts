import { lookup as mimeLookup } from 'mime-types';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { logger } from './logger.js';
import { trpc } from './trpc.js';

type MediaType = 'image' | 'video';

const imageExt = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']);
const videoExt = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv']);
const allowed = new Set([...imageExt, ...videoExt]);

function bucket(ext: string): MediaType | null {
  if (imageExt.has(ext)) return 'image';
  if (videoExt.has(ext)) return 'video';
  return null;
}

type FileRec = {
  path: string;
  name: string;
  size: number;
  type: MediaType;
  mime: string;
  fileCreatedAt: Date;
  encoded: boolean;
};

export async function scan(rootDir: string) {
  if (!existsSync(rootDir)) {
    logger.warn(`Scan skipped, path not found: ${rootDir}`);
    return { folders: [], totalFiles: 0, byFolder: new Map<string, FileRec[]>() };
  }

  const folders: string[] = [];
  const byFolder = new Map<string, FileRec[]>();

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
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = extname(entry.name).slice(1).toLowerCase();
      if (!allowed.has(ext)) continue;

      const type = bucket(ext);
      if (!type) continue;

      let stat;
      try {
        stat = statSync(fullPath);
      } catch (error) {
        logger.warn(`Failed to stat file, skipping: ${fullPath}`);
        continue;
      }
      const mime = mimeLookup(ext) || (type === 'image' ? 'image/*' : 'video/*');

      //derive a file creation date
      let fileCreatedAt: Date;
      try {
        // if you want EXIF metadata for images:
        // const tags = await ExifReader.load(fullPath);
        // fileCreatedAt = tags['DateTimeOriginal']?.description
        //   ? new Date(tags['DateTimeOriginal'].description)
        //   : stat.birthtime;
        fileCreatedAt = stat.birthtime; // fallback for now
      } catch {
        fileCreatedAt = stat.birthtime;
      }

      const rec: FileRec = {
        path: fullPath,
        name: entry.name,
        size: stat.size,
        type,
        mime: String(mime),
        fileCreatedAt,
        encoded: false, //default to false when first scanned
      };

      const arr = byFolder.get(dir) ?? [];
      arr.push(rec);
      byFolder.set(dir, arr);
    }
  }

  walk(rootDir);

  for (const folder of folders) {
    // Get all the files in this folder.
    const files = byFolder.get(folder) ?? [];

    // Get all the files already in the database for this folder.
    const alreadySavedFiles = await trpc.files.getFilesInDir.mutate(folder);

    const alreadySavedPaths = new Set(alreadySavedFiles.map((f: { path: string }) => f.path));

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
    const pathsOnDisk = new Set(files.map((f) => f.path));
    const orphanedFiles = alreadySavedFiles.filter(
      (f: { path: string }) => !pathsOnDisk.has(f.path),
    );
    if (orphanedFiles.length > 0) {
      logger.info(`Removing ${orphanedFiles.length} orphaned files for folder: ${folder}`);
      await trpc.files.removeFilesById.mutate(orphanedFiles.map((f: { id: string }) => f.id));
    }

    // Filter out files that are already in the database.
    const filesToAdd = files
      .filter((f) => !alreadySavedPaths.has(f.path))
      .map((f) => ({
        path: f.path,
        dir: folder,
        type: f.type,
        mime: f.mime,
        name: f.name,
        size: f.size,
        fileCreatedAt: f.fileCreatedAt,
        encoded: f.encoded,
      }));

    if (!filesToAdd.length) {
      logger.info(`No new files to add for folder: ${folder}`);
      continue;
    }

    logger.info(`Adding ${filesToAdd.length} new files for folder: ${folder}`);

    //get Ids of files just created
    const fileIds = (await trpc.files.create.mutate(filesToAdd)).map((f: { id: string }) => f.id);

    //get the default libraryId to associate files with
    const libraryId = await trpc.library.getDefaultLibraryId.query();

    //save all files to library
    await trpc.libraryFile.create.mutate(
      fileIds.map((fileId) => ({
        fileId,
        libraryId,
      })),
    );
  }

  console.log('anil test:', folders);

  const total = Array.from(byFolder.values()).reduce((n, a) => n + a.length, 0);

  return { folders, totalFiles: total, byFolder };
}
