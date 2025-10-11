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
  logger.info(
    `[encode:image] start id=${file.id} name="${file.name}" mime=${file.mime} size=${file.size}`,
  );

  // Get upload path from settings
  const settings = await trpc.settings.get.query();
  const uploadDir = settings?.uploadPath;
  if (!uploadDir) {
    throw new Error('uploadPath missing from settings');
  }

  const containerRootPrefix = process.env['HOST_ROOT_PREFIX'];
  const toContainerPath = (p: string) =>
    containerRootPrefix && containerRootPrefix.trim() !== ''
      ? p === '/'
        ? containerRootPrefix
        : `${containerRootPrefix}${p}`
      : p;
  const hostPath = join(file.dir, file.name);
  const path = toContainerPath(hostPath);
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

  let thumb;
  try {
    thumb = await sharp(input)
      .rotate()
      .resize({ width: 320, height: 320, fit: 'cover', withoutEnlargement: true })
      .avif({ quality: 45, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    logger.error(`[encode:image] thumbnail failed for id=${fileId}`, e as Error);
    throw e;
  }

  let opt;
  try {
    opt = await sharp(input)
      .rotate()
      .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 50, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    logger.error(`[encode:image] optimise failed for id=${fileId}`, e as Error);
    throw e;
  }

  writeFileSync(thumbPath, thumb.data);
  writeFileSync(optPath, opt.data);

  logger.debug(
    `[encode:image] saving variants for id=${fileId} thumbBytes=${thumb.data.length} optBytes=${opt.data.length}`,
  );
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

  const {
    lon,
    lat,
    takenAt,
    cameraMake,
    cameraModel,
    lensModel,
    iso,
    exposureTime,
    focalLength,
    fNumber,
  } = await getExifInfo(path);

  // Save image metadata (width, height, takenAt). If no EXIF takenAt, fall back to file.createdAt
  if (width && height) {
    const takenAtFinal =
      takenAt ?? (file.createdAt ? new Date(file.createdAt as unknown as string) : new Date());
    logger.debug(
      `[encode:image] saving metadata id=${fileId} width=${width} height=${height} takenAt=${takenAtFinal?.toISOString?.() ?? 'null'}`,
    );
    await trpc.imageMetadata.save.mutate({
      fileId,
      width,
      height,
      takenAt: takenAtFinal,
      cameraMake: cameraMake ?? null,
      cameraModel: cameraModel ?? null,
      lensModel: lensModel ?? null,
      iso: iso ?? null,
      exposureTime: exposureTime ?? null,
      focalLength: focalLength ?? null,
      fNumber: (typeof fNumber === 'number' ? String(fNumber) : fNumber) ?? null,
    });
  }

  // Save geo location if available
  if (lat != null && lon != null) {
    try {
      logger.debug(`[encode:image] saving geolocation id=${fileId} lat=${lat} lon=${lon}`);
      await trpc.geoLocation.save.mutate({ fileId, lat, lon });
    } catch (e) {
      console.warn('Failed to save geo location for', fileId, e);
    }
  }
  logger.info(`[encode:image] done id=${file.id}`);
  try {
    await trpc.issues.resolveForFile.mutate({ fileId: file.id });
  } catch {}
}

export async function encode(fileId: string) {
  logger.info(`[encode] start fileId=${fileId}`);
  const fileResult = await trpc.files.getFileById.query(fileId);
  if (fileResult.optimized || fileResult.thumbnail) {
    logger.info(`[encode] already encoded, skipping fileId=${fileId}`);
    return;
  }

  const file = fileResult.raw;
  if (file.type === 'image') {
    if (file.mime === 'image/svg+xml') return;
    try {
      await encodeImage(file);
    } catch (e) {
      logger.error(`[encode] image failed fileId=${fileId}`, e as Error);
      try {
        await trpc.issues.record.mutate({
          fileId,
          stage: 'encode',
          message: (e as Error)?.message || 'encode image failed',
        });
      } catch {}
      throw e;
    }
    return;
  }

  if (file.type === 'video') {
    try {
      await encodeVideo(file);
    } catch (e) {
      logger.error(`[encode] video failed fileId=${fileId}`, e as Error);
      try {
        await trpc.issues.record.mutate({
          fileId,
          stage: 'encode',
          message: (e as Error)?.message || 'encode video failed',
        });
      } catch {}
      throw e;
    }
    return;
  }
}

async function runFfmpeg(args: string[], label: string) {
  return new Promise<void>((resolve, reject) => {
    logger.debug(`[ffmpeg:${label}] spawn ${args.join(' ')}`);
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      logger.error(`[ffmpeg:${label}] failed code=${code} stderr=${stderr}`);
      reject(new Error(`ffmpeg ${label} failed (code ${code}): ${stderr}`));
    });
    child.on('error', (err) => reject(err));
  });
}

async function encodeVideo(file: File) {
  logger.info(
    `[encode:video] start id=${file.id} name="${file.name}" mime=${file.mime} size=${file.size}`,
  );

  const settings = await trpc.settings.get.query();
  const uploadDir = settings?.uploadPath;
  if (!uploadDir) {
    throw new Error('uploadPath missing from settings');
  }

  const containerRootPrefix = process.env['HOST_ROOT_PREFIX'];
  const toContainerPath = (p: string) =>
    containerRootPrefix && containerRootPrefix.trim() !== ''
      ? p === '/'
        ? containerRootPrefix
        : `${containerRootPrefix}${p}`
      : p;
  const inputPath = toContainerPath(join(file.dir, file.name));
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
  const { width, height, takenAt, lat, lon, cameraMake, cameraModel, lensModel } =
    await getVideoMetadata(inputPath);

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

  logger.debug(
    `[encode:video] saving variants for id=${file.id} thumbBytes=${thumbSize} optBytes=${optSize}`,
  );
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
    logger.debug(
      `[encode:video] saving metadata id=${file.id} width=${width} height=${height} takenAt=${takenAtFinal?.toISOString?.() ?? 'null'}`,
    );
    await trpc.imageMetadata.save.mutate({
      fileId: file.id,
      width,
      height,
      takenAt: takenAtFinal,
      cameraMake: cameraMake ?? null,
      cameraModel: cameraModel ?? null,
      lensModel: lensModel ?? null,
    });
  }

  // Save geo location if available
  if (lat != null && lon != null) {
    try {
      logger.debug(`[encode:video] saving geolocation id=${file.id} lat=${lat} lon=${lon}`);
      await trpc.geoLocation.save.mutate({ fileId: file.id, lat, lon });
    } catch (e) {
      console.warn('Failed to save geo location for', file.id, e);
    }
  }
  logger.info(`[encode:video] done id=${file.id}`);
  try {
    await trpc.issues.resolveForFile.mutate({ fileId: file.id });
  } catch {}
}
