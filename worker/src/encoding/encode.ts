import { encode as encodeBlurhash } from 'blurhash';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import { getExifInfo } from '../utils/exif.js';
import { getVideoMetadata } from '../utils/ffprobe.js';
import { logger } from '../utils/logger.js';
import { type RouterOutputs, trpc } from '../utils/trpc.js';

type File = RouterOutputs['files']['getFileById']['raw'];

// Get a stable identifier for encoding folder names.
// Prefers contentHash (true deduplication) if available, falls back to path hash.
// This stays consistent even if the DB is reset and file gets a new UUID.
function getFileStableHash(file: File): string {
  // Use content hash if available (true deduplication across duplicate files)
  if (file.contentHash) {
    return file.contentHash.slice(0, 16);
  }
  // Fall back to path hash (stable across DB resets, but no deduplication)
  const fullPath = join(file.dir, file.name);
  return createHash('sha256').update(fullPath).digest('hex').slice(0, 16);
}

async function encodeImage(file: File, existingVariants?: { thumbPath: string; optPath: string }) {
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

  // Generate blurhash from a small version of the image
  let blurhash: string | null = null;
  try {
    const smallImg = await sharp(input)
      .rotate()
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    blurhash = encodeBlurhash(
      new Uint8ClampedArray(smallImg.data),
      smallImg.info.width,
      smallImg.info.height,
      4,
      3,
    );
  } catch (e) {
    logger.warn(`[encode:image] blurhash generation failed for id=${fileId}`, e as Error);
  }

  // Use path hash for stable folder naming across DB resets
  const pathHash = getFileStableHash(file);
  const destDir = join(uploadDir, 'images', pathHash);
  mkdirSync(destDir, { recursive: true });

  const base = basename(file.name, extname(file.name));
  const thumbName = `${base}__thumb.avif`;
  const optName = `${base}__opt.avif`;
  const thumbPath = join(destDir, thumbName);
  const optPath = join(destDir, optName);

  // If variants already exist on disk, reuse them instead of re-encoding
  let thumb: { data: Buffer; info: { size: number } };
  let opt: { data: Buffer; info: { size: number } };

  if (existingVariants) {
    logger.info(`[encode:image] reusing existing variants on disk for id=${fileId}`);
    const thumbData = readFileSync(existingVariants.thumbPath);
    const optData = readFileSync(existingVariants.optPath);
    thumb = { data: thumbData, info: { size: thumbData.length } };
    opt = { data: optData, info: { size: optData.length } };
  } else {
    try {
      const thumbResult = await sharp(input)
        .rotate()
        .resize({ width: 320, height: 320, fit: 'cover', withoutEnlargement: true })
        .avif({ quality: 45, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      thumb = { data: thumbResult.data, info: { size: thumbResult.data.length } };
    } catch (e) {
      logger.error(`[encode:image] thumbnail failed for id=${fileId}`, e as Error);
      throw e;
    }

    try {
      const optResult = await sharp(input)
        .rotate()
        .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
        .avif({ quality: 50, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      opt = { data: optResult.data, info: { size: optResult.data.length } };
    } catch (e) {
      logger.error(`[encode:image] optimise failed for id=${fileId}`, e as Error);
      throw e;
    }

    writeFileSync(thumbPath, thumb.data);
    writeFileSync(optPath, opt.data);
  }

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

  // Save image metadata (width, height, takenAt). Only use real EXIF takenAt, do not default
  if (width && height) {
    logger.debug(
      `[encode:image] saving metadata id=${fileId} width=${width} height=${height} takenAt=${takenAt?.toISOString?.() ?? 'null'}`,
    );
    await trpc.imageMetadata.save.mutate({
      fileId,
      width,
      height,
      blurhash,
      takenAt: takenAt ?? null,
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
  try {
    await trpc.issues.resolveForFile.mutate({ fileId: file.id });
  } catch {}
}

export async function encode(fileId: string) {
  const startedAt = Date.now();
  const fileResult = await trpc.files.getFileById.query(fileId);
  const file = fileResult.raw;

  // Get upload path from settings for filesystem checks
  const settings = await trpc.settings.get.query();
  const uploadDir = settings?.uploadPath;

  // If both required variants already exist in DB, mark tasks as succeeded and skip work
  const hasThumb = !!fileResult.thumbnail;
  const hasOpt = !!fileResult.optimized;
  if (file.type === 'image' && hasThumb && hasOpt) {
    await trpc.fileTask.setManyStatusByFileAndType.mutate([
      { fileId, type: 'encode_thumbnail', status: 'succeeded' },
      { fileId, type: 'encode_optimised', status: 'succeeded' },
    ]);
    logger.info(`[encode] [image] ${fileId} | ${Date.now() - startedAt}ms`);
    return;
  }
  if (file.type === 'video' && hasThumb && hasOpt) {
    await trpc.fileTask.setManyStatusByFileAndType.mutate([
      { fileId, type: 'video_poster', status: 'succeeded' },
      { fileId, type: 'encode_optimised', status: 'succeeded' },
    ]);
    logger.info(`[encode] [video] ${fileId} | ${Date.now() - startedAt}ms`);
    return;
  }

  if (file.type === 'image') {
    if (file.mime === 'image/svg+xml') return;
    try {
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'encode_thumbnail', status: 'in_progress' },
        { fileId, type: 'encode_optimised', status: 'in_progress' },
      ]);

      // Check if encoded files already exist on disk (DB may have been reset)
      let existingVariants: { thumbPath: string; optPath: string } | undefined;
      if (uploadDir) {
        const pathHash = getFileStableHash(file);
        const destDir = join(uploadDir, 'images', pathHash);
        const base = basename(file.name, extname(file.name));
        const thumbPath = join(destDir, `${base}__thumb.avif`);
        const optPath = join(destDir, `${base}__opt.avif`);
        if (existsSync(thumbPath) && existsSync(optPath)) {
          logger.info(`[encode] found existing encoded files on disk for image id=${fileId}`);
          existingVariants = { thumbPath, optPath };
        }
      }

      await encodeImage(file, existingVariants);
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'encode_thumbnail', status: 'succeeded' },
        { fileId, type: 'encode_optimised', status: 'succeeded' },
      ]);
      logger.info(`[encode] [image] ${fileId} | ${Date.now() - startedAt}ms`);
    } catch (e) {
      logger.error(`[encode] image failed fileId=${fileId}`, e as Error);
      try {
        await trpc.fileTask.setManyStatusByFileAndType.mutate([
          {
            fileId,
            type: 'encode_thumbnail',
            status: 'failed',
            error: (e as Error)?.message,
            incrementAttempts: true,
          },
          {
            fileId,
            type: 'encode_optimised',
            status: 'failed',
            error: (e as Error)?.message,
            incrementAttempts: true,
          },
        ]);
      } catch (statusErr) {
        logger.error('[encode] failed to mark image tasks failed', statusErr as Error);
      }
      try {
        // no-op (issues retired)
      } catch {}
      return;
    }
    return;
  }

  if (file.type === 'video') {
    try {
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'video_poster', status: 'in_progress' },
        { fileId, type: 'encode_optimised', status: 'in_progress' },
      ]);

      // Check if encoded files already exist on disk (DB may have been reset)
      let existingVideoVariants: { thumbPath: string; optPath: string } | undefined;
      if (uploadDir) {
        const pathHash = getFileStableHash(file);
        const destDir = join(uploadDir, 'videos', pathHash);
        const base = basename(file.name, extname(file.name));
        const thumbPath = join(destDir, `${base}__thumb.jpg`);
        const optPath = join(destDir, `${base}__opt.mp4`);
        if (existsSync(thumbPath) && existsSync(optPath)) {
          logger.info(`[encode] found existing encoded files on disk for video id=${fileId}`);
          existingVideoVariants = { thumbPath, optPath };
        }
      }

      await encodeVideo(file, existingVideoVariants);
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'video_poster', status: 'succeeded' },
        { fileId, type: 'encode_optimised', status: 'succeeded' },
      ]);
      logger.info(`[encode] [video] ${fileId} | ${Date.now() - startedAt}ms`);
    } catch (e) {
      logger.error(`[encode] video failed fileId=${fileId}`, e as Error);
      try {
        await trpc.fileTask.setManyStatusByFileAndType.mutate([
          {
            fileId,
            type: 'video_poster',
            status: 'failed',
            error: (e as Error)?.message,
            incrementAttempts: true,
          },
          {
            fileId,
            type: 'encode_optimised',
            status: 'failed',
            error: (e as Error)?.message,
            incrementAttempts: true,
          },
        ]);
      } catch (statusErr) {
        logger.error('[encode] failed to mark video tasks failed', statusErr as Error);
      }
      try {
        // no-op (issues retired)
      } catch {}
      return;
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

async function encodeVideo(file: File, existingVariants?: { thumbPath: string; optPath: string }) {
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

  // Use path hash for stable folder naming across DB resets
  const pathHash = getFileStableHash(file);
  const destDir = join(uploadDir, 'videos', pathHash);
  mkdirSync(destDir, { recursive: true });

  const base = basename(file.name, extname(file.name));
  const thumbName = `${base}__thumb.jpg`;
  const optName = `${base}__opt.mp4`;
  const thumbPath = join(destDir, thumbName);
  const optPath = join(destDir, optName);

  // Extract metadata (width/height, takenAt, geo) from source video
  const { width, height, takenAt, lat, lon, cameraMake, cameraModel, lensModel } =
    await getVideoMetadata(inputPath);

  let thumbSize: number;
  let optSize: number;

  // If variants already exist on disk, reuse them instead of re-encoding
  if (existingVariants) {
    logger.info(`[encode:video] reusing existing variants on disk for id=${file.id}`);
    thumbSize = statSync(existingVariants.thumbPath).size;
    optSize = statSync(existingVariants.optPath).size;
  } else {
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

    // Poster frame (first frame), scaled to width 320px
    await runFfmpeg(
      ['-y', '-i', inputPath, '-frames:v', '1', '-vf', "scale='320':'-2'", '-q:v', '2', thumbPath],
      'thumbnail',
    );

    thumbSize = statSync(thumbPath).size;
    optSize = statSync(optPath).size;
  }

  // Generate blurhash from the poster frame
  let blurhash: string | null = null;
  try {
    const thumbInput = readFileSync(thumbPath);
    const smallImg = await sharp(thumbInput)
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    blurhash = encodeBlurhash(
      new Uint8ClampedArray(smallImg.data),
      smallImg.info.width,
      smallImg.info.height,
      4,
      3,
    );
  } catch (e) {
    logger.warn(`[encode:video] blurhash generation failed for id=${file.id}`, e as Error);
  }

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

  // Save video metadata (width, height, takenAt). Only use real takenAt from video tags, do not default
  if (width && height) {
    logger.debug(
      `[encode:video] saving metadata id=${file.id} width=${width} height=${height} takenAt=${takenAt?.toISOString?.() ?? 'null'}`,
    );
    await trpc.imageMetadata.save.mutate({
      fileId: file.id,
      width,
      height,
      blurhash,
      takenAt: takenAt ?? null,
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
  try {
    await trpc.issues.resolveForFile.mutate({ fileId: file.id });
  } catch {}
}
