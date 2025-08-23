import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { trpc } from './trpc.js';
import { lookup as mimeLookup } from 'mime-types';
import { logger } from './logger.js';

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
};

export async function scan(rootDir: string) {
  const folders: string[] = [];
  const byFolder = new Map<string, FileRec[]>();

  function walk(dir: string) {
    folders.push(dir);
    const entries = readdirSync(dir, { withFileTypes: true });

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

      const stat = statSync(fullPath);
      const mime = mimeLookup(ext) || (type === 'image' ? 'image/*' : 'video/*');

      const rec: FileRec = {
        path: fullPath,
        name: entry.name,
        size: stat.size,
        type,
        mime: String(mime),
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
      }));

    if (!filesToAdd.length) {
      logger.info(`No new files to add for folder: ${folder}`);
      continue;
    }

    logger.info(`Adding ${filesToAdd.length} new files for folder: ${folder}`);

    await trpc.files.create.mutate(filesToAdd);
  }

  const total = Array.from(byFolder.values()).reduce((n, a) => n + a.length, 0);

  return { folders, totalFiles: total, byFolder };
}
