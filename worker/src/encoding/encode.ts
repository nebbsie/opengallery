import { type RouterOutputs, trpc } from '../utils/trpc.js';
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';

type FileResult = RouterOutputs['files']['getFileById'];
type File = RouterOutputs['files']['getFileById']['raw'];

export async function encode(fileId: string) {
  const fileResult = await trpc.files.getFileById.query(fileId);
  if (fileResult.optimized || fileResult.thumbnail) return;

  console.log('encoding file: ', fileId);

  const file: File = fileResult.raw;
  if (file.type !== 'image' || file.mime === 'image/svg+xml') return;

  console.log('encoding: ', join(file.dir, file.name));

  const settings = await trpc.settings.get.query();
  const uploadDir = settings?.uploadPath;
  if (!uploadDir) throw new Error('uploadPath missing from settings');

  const origPath = join(file.dir, file.name);
  const input = await fs.readFile(origPath);

  const dt = new Date(file.createdAt || Date.now());
  const yyyy = String(dt.getUTCFullYear());
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');

  const destDir = join(uploadDir, 'images', yyyy, mm, dd, file.id);
  await fs.mkdir(destDir, { recursive: true });

  const base = basename(file.name, extname(file.name));
  const thumbName = `${base}__thumb.avif`;
  const optName = `${base}__opt.avif`;
  const thumbPath = join(destDir, thumbName);
  const optPath = join(destDir, optName);

  const thumb = await sharp(input)
    .rotate()
    .resize({ width: 320, height: 320, fit: 'cover', withoutEnlargement: true })
    .avif({ quality: 45, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  const opt = await sharp(input)
    .rotate()
    .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
    .avif({ quality: 50, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  await Promise.all([fs.writeFile(thumbPath, thumb.data), fs.writeFile(optPath, opt.data)]);

  await trpc.files.saveVariants.mutate({
    originalFileId: fileId, // aligns with procedure definition
    variants: [
      {
        type: 'thumbnail',
        fileType: 'image',
        dir: destDir, // folder only
        name: thumbName, // file name with extension
        mime: 'image/avif',
        size: thumb.data.length,
      },
      {
        type: 'optimised',
        fileType: 'image',
        dir: destDir,
        name: optName,
        mime: 'image/avif',
        size: opt.data.length,
      },
    ],
  });
}
