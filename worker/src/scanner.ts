import { readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { trpc } from './trpc.js';
import { Dirent } from 'fs';

const allowed = new Set([
  // Photos
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'tiff',
  // Videos
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'wmv',
  'flv',
]);

export async function scan(directory: string) {
  const mediaFiles: Dirent<string>[] = [];
  const folders: Dirent<string>[] = [];

  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        folders.push(entry);
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).slice(1).toLowerCase();
        if (allowed.has(ext)) {
          mediaFiles.push(entry);
        }
      }
    }
  }

  walk(directory);

  console.log('Media files:', mediaFiles);

  for (const file of mediaFiles) {
    await trpc.files.create.mutate({
      path: file.path,
      type: 'image',
      mime: '',
      name: '',
      size: 0,
    });
  }

  console.log('Folders:', folders);
  return { mediaFiles, folders };
}
