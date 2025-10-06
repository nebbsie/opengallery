import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import { getExifInfo } from '../utils/exif.js';
import { getVideoMetadata } from '../utils/ffprobe.js';
import { logger } from '../utils/logger.js';
import { type RouterOutputs, trpc } from '../utils/trpc.js';

type File = RouterOutputs['files']['getFileById']['raw'];

async function encodeImage(file: File) {
  logger.debug(`Encoding image ${file.id} (${file.name})`);

  // Get upload path from settings
  const settings = await trpc.settings.get.query();
  const uploadDir = settings?.uploadPath;
  if (!uploadDir) {
    throw new Error('uploadPath missing from settings');
  }

  const path = join(file.dir, file.name);
  const input = readFileSync(path);
  const fileId = file.id;

  // Extract metadata (width/height) early using sharp
  const metadata = await sharp(input).metadata();
  const width = metadata.width ?? null;
  const height = metadata.height ?? null;

  const dt = new Date(file.createdAt || Date.now());
  const yyyy = String(dt.getUTCFullYear());
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');

  const destDir = join(uploadDir, 'images', yyyy, mm, dd, file.id);
  mkdirSync(destDir, { recursive: true });

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

  writeFileSync(thumbPath, thumb.data);
  writeFileSync(optPath, opt.data);

  await trpc.files.saveVariants.mutate({
    originalFileId: fileId, // aligns with procedure definition
    variants: [
      {
        type: 'thumbnail',
        fileType: 'image',
        dir: destDir,
        name: thumbName,
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

  const { lon, lat, takenAt } = await getExifInfo(path);

  // Save image metadata (width, height, takenAt). If no EXIF takenAt, fall back to file.createdAt
  if (width && height) {
    const takenAtFinal =
      takenAt ?? (file.createdAt ? new Date(file.createdAt as unknown as string) : new Date());
    await trpc.imageMetadata.save.mutate({
      fileId,
      width,
      height,
      takenAt: takenAtFinal,
    });
  }

  // Save geo location if available
  if (lat != null && lon != null) {
    try {
      await trpc.geoLocation.save.mutate({ fileId, lat, lon });
    } catch (e) {
      console.warn('Failed to save geo location for', fileId, e);
    }
  }
}

export async function encode(fileId: string) {
  const fileResult = await trpc.files.getFileById.query(fileId);
  if (fileResult.optimized || fileResult.thumbnail) {
    return;
  }

  const file = fileResult.raw;
  if (file.type === 'image') {
    if (file.mime === 'image/svg+xml') return;
    await encodeImage(file);
    return;
  }

  if (file.type === 'video') {
    await encodeVideo(file);
    return;
  }
}

async function runFfmpeg(args: string[], label: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg ${label} failed (code ${code}): ${stderr}`));
    });
    child.on('error', (err) => reject(err));
  });
}

async function encodeVideo(file: File) {
  logger.debug(`Encoding video ${file.id} (${file.name})`);

  const settings = await trpc.settings.get.query();
  const uploadDir = settings?.uploadPath;
  if (!uploadDir) {
    throw new Error('uploadPath missing from settings');
  }

  const inputPath = join(file.dir, file.name);
  const dt = new Date(file.createdAt || Date.now());
  const yyyy = String(dt.getUTCFullYear());
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');

  const destDir = join(uploadDir, 'videos', yyyy, mm, dd, file.id);
  mkdirSync(destDir, { recursive: true });

  const base = basename(file.name, extname(file.name));
  const thumbName = `${base}__thumb.jpg`;
  const optName = `${base}__opt.mp4`;
  const thumbPath = join(destDir, thumbName);
  const optPath = join(destDir, optName);

  // Extract metadata (width/height, takenAt, geo) from source video
  const { width, height, takenAt, lat, lon } = await getVideoMetadata(inputPath);

  // Optimised MP4 (H.264/AAC, faststart, max 1080p, yuv420p)
  await runFfmpeg(
    [
      '-y',
      '-i',
      inputPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-profile:v',
      'high',
      '-level',
      '4.1',
      '-pix_fmt',
      'yuv420p',
      '-vf',
      "scale='min(1920,iw)':'-2'",
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      optPath,
    ],
    'optimise',
  );

  // Poster frame (~1s in), scaled to width 320px
  await runFfmpeg(
    [
      '-y',
      '-ss',
      '00:00:01',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      "scale='320':'-2'",
      '-q:v',
      '2',
      thumbPath,
    ],
    'thumbnail',
  );

  const thumbSize = statSync(thumbPath).size;
  const optSize = statSync(optPath).size;

  await trpc.files.saveVariants.mutate({
    originalFileId: file.id,
    variants: [
      {
        type: 'thumbnail',
        fileType: 'image',
        dir: destDir,
        name: thumbName,
        mime: 'image/jpeg',
        size: thumbSize,
      },
      {
        type: 'optimised',
        fileType: 'video',
        dir: destDir,
        name: optName,
        mime: 'video/mp4',
        size: optSize,
      },
    ],
  });

  // Save video metadata (width, height, takenAt). If no takenAt via tags, fall back to createdAt
  if (width && height) {
    const takenAtFinal =
      takenAt ?? (file.createdAt ? new Date(file.createdAt as unknown as string) : new Date());
    await trpc.imageMetadata.save.mutate({
      fileId: file.id,
      width,
      height,
      takenAt: takenAtFinal,
    });
  }

  // Save geo location if available
  if (lat != null && lon != null) {
    try {
      await trpc.geoLocation.save.mutate({ fileId: file.id, lat, lon });
    } catch (e) {
      console.warn('Failed to save geo location for', file.id, e);
    }
  }
}
