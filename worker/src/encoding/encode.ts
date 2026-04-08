import { encode as encodeBlurhash } from 'blurhash';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import { validateCamera } from '../utils/camera-validator.js';
import { getExifInfo } from '../utils/exif.js';
import { getVideoMetadata } from '../utils/ffprobe.js';
import { throttleIo } from '../utils/io-throttle.js';
import { logger } from '../utils/logger.js';
import { toContainerPath } from '../utils/paths.js';
import { type RouterOutputs, trpc } from '../utils/trpc.js';

type File = RouterOutputs['files']['getFileById']['raw'];
type EncodeStatus = 'success' | 'failed';
type EncodeResult = { type: 'image' | 'video'; status: EncodeStatus };

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

async function encodeImage(
  file: File,
  existingVariants?: {
    thumbPath: string;
    optPath: string;
    thumbQuality: number | undefined;
    optQuality: number | undefined;
  },
) {
  const timings: Record<string, number> = {};
  let stepStart = Date.now();

  // Get variants path (or fall back to uploadPath for backwards compatibility)
  const settings = await trpc.settings.get.query();
  const variantsPath = settings?.variantsPath ?? settings?.uploadPath;
  if (!variantsPath) {
    throw new Error('variantsPath missing from settings');
  }

  const thumbQuality = settings?.thumbnailQuality ?? 70;
  const optQuality = settings?.optimizedQuality ?? 80;

  const hostPath = join(file.dir, file.name);
  const path = toContainerPath(hostPath);
  const fileId = file.id;

  // Use Sharp's file path input instead of loading entire file into memory
  // This is more memory efficient for large images (RAW files can be 50MB+)
  const sharpInstance = sharp(path);

  // Extract metadata (width/height) early using sharp
  const metadata = await sharpInstance.metadata();
  const width = metadata.width ?? null;
  const height = metadata.height ?? null;
  timings['metadata'] = Date.now() - stepStart;
  stepStart = Date.now();

  // Generate blurhash from a small version of the image
  let blurhash: string | null = null;
  try {
    const smallImg = await sharp(path)
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
  timings['blurhash'] = Date.now() - stepStart;
  stepStart = Date.now();

  // Use path hash for stable folder naming across DB resets
  const pathHash = getFileStableHash(file);
  const destDir = join(variantsPath, 'images', pathHash);
  await mkdir(destDir, { recursive: true });

  const base = basename(file.name, extname(file.name));
  const thumbName = `${base}__thumb.avif`;
  const optName = `${base}__opt.avif`;
  const thumbPath = join(destDir, thumbName);
  const optPath = join(destDir, optName);

  // If variants already exist on disk, check if quality matches - re-encode if not
  const needsReencode =
    existingVariants &&
    (existingVariants.thumbQuality !== thumbQuality || existingVariants.optQuality !== optQuality);

  let thumb: { data: Buffer; info: { size: number } };
  let opt: { data: Buffer; info: { size: number } };

  if (existingVariants && !needsReencode) {
    logger.info(`[encode:image] reusing existing variants on disk for id=${fileId}`);
    const [thumbData, optData] = await Promise.all([
      throttleIo(() => readFile(existingVariants.thumbPath)),
      throttleIo(() => readFile(existingVariants.optPath)),
    ]);
    thumb = { data: thumbData, info: { size: thumbData.length } };
    opt = { data: optData, info: { size: optData.length } };
  } else {
    if (needsReencode) {
      logger.info(
        `[encode:image] re-encoding due to quality change: thumb ${existingVariants.thumbQuality}->${thumbQuality}, opt ${existingVariants.optQuality}->${optQuality} for id=${fileId}`,
      );
    }

    try {
      // Use file path input for Sharp (more memory efficient)
      const thumbResult = await sharp(path)
        .rotate()
        .resize({ width: 320, height: 320, fit: 'cover', withoutEnlargement: true })
        .avif({ quality: thumbQuality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      thumb = { data: thumbResult.data, info: { size: thumbResult.data.length } };
    } catch (e) {
      logger.error(`[encode:image] thumbnail failed for id=${fileId}`, e as Error);
      throw e;
    }

    timings['thumbnail'] = Date.now() - stepStart;
    stepStart = Date.now();

    try {
      const optResult = await sharp(path)
        .rotate()
        .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
        .avif({ quality: optQuality, effort: 3 })
        .toBuffer({ resolveWithObject: true });
      opt = { data: optResult.data, info: { size: optResult.data.length } };
    } catch (e) {
      logger.error(`[encode:image] optimise failed for id=${fileId}`, e as Error);
      throw e;
    }
    timings['optimised'] = Date.now() - stepStart;
    stepStart = Date.now();

    // Write files sequentially with I/O throttling to reduce disk pressure
    await throttleIo(() => writeFile(thumbPath, thumb.data));
    await throttleIo(() => writeFile(optPath, opt.data));
    timings['write_files'] = Date.now() - stepStart;
    stepStart = Date.now();
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
        quality: thumbQuality,
      },
      {
        type: 'optimised',
        fileType: 'image',
        dir: destDir,
        name: optName,
        mime: 'image/avif',
        size: opt.data.length,
        quality: optQuality,
      },
    ],
  });
  timings['save_variants'] = Date.now() - stepStart;
  stepStart = Date.now();

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
  timings['exif'] = Date.now() - stepStart;
  stepStart = Date.now();

  const validatedCamera = validateCamera(cameraMake ?? null, cameraModel ?? null);

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
      cameraMake: validatedCamera.isValid ? validatedCamera.cameraMake : null,
      cameraModel: validatedCamera.isValid ? validatedCamera.cameraModel : null,
      lensModel: lensModel ?? null,
      iso: iso ?? null,
      exposureTime: exposureTime ?? null,
      focalLength: focalLength ?? null,
      fNumber: (typeof fNumber === 'number' ? String(fNumber) : fNumber) ?? null,
    });
  }

  timings['save_metadata'] = Date.now() - stepStart;
  stepStart = Date.now();

  // Save geo location if available
  if (lat != null && lon != null) {
    try {
      logger.debug(`[encode:image] saving geolocation id=${fileId} lat=${lat} lon=${lon}`);
      await trpc.geoLocation.save.mutate({ fileId, lat, lon });
    } catch (e) {
      logger.warn('Failed to save geo location', { fileId, error: e });
    }
  }
  timings['save_geo'] = Date.now() - stepStart;

  const total = Object.values(timings).reduce((a, b) => a + b, 0);
  const breakdown = Object.entries(timings)
    .map(([k, v]) => `${k}=${v}ms`)
    .join(' ');
  logger.info(`[encode:image] timings id=${fileId} total=${total}ms | ${breakdown}`);
}

export async function encode(fileId: string): Promise<EncodeResult | null> {
  const startedAt = Date.now();
  const fileResult = await trpc.files.getFileById.query(fileId);
  const file = fileResult.raw;

  // Get variants path from settings for filesystem checks (fall back to uploadPath)
  const settings = await trpc.settings.get.query();
  const variantsPath = settings?.variantsPath ?? settings?.uploadPath;

  const thumbQuality = settings?.thumbnailQuality ?? 70;
  const optQuality = settings?.optimizedQuality ?? 80;

  // If both required variants exist in DB and quality matches, skip encoding
  const hasThumb = !!fileResult.thumbnail;
  const hasOpt = !!fileResult.optimized;
  const thumbQualityMatches = fileResult.thumbnail?.quality === thumbQuality;
  const optQualityMatches = fileResult.optimized?.quality === optQuality;

  if (file.type === 'image' && hasThumb && hasOpt && thumbQualityMatches && optQualityMatches) {
    await trpc.fileTask.setManyStatusByFileAndType.mutate([
      { fileId, type: 'encode_thumbnail', status: 'succeeded' },
      { fileId, type: 'encode_optimised', status: 'succeeded' },
    ]);
    logger.info(`[encode] [image] ${fileId} | ${Date.now() - startedAt}ms`);
    return { type: 'image', status: 'success' };
  }

  // Log if quality changed and we need to re-encode
  if (file.type === 'image' && hasThumb && hasOpt && (!thumbQualityMatches || !optQualityMatches)) {
    logger.info(
      `[encode] re-encoding image due to quality change: thumb ${fileResult.thumbnail?.quality}->${thumbQuality}, opt ${fileResult.optimized?.quality}->${optQuality} for id=${fileId}`,
    );
  }

  if (file.type === 'video' && hasThumb && hasOpt) {
    await trpc.fileTask.setManyStatusByFileAndType.mutate([
      { fileId, type: 'video_poster', status: 'succeeded' },
      { fileId, type: 'encode_optimised', status: 'succeeded' },
    ]);
    logger.info(`[encode] [video] ${fileId} | ${Date.now() - startedAt}ms`);
    return { type: 'video', status: 'success' };
  }

  if (file.type === 'image') {
    if (file.mime === 'image/svg+xml') return null;
    try {
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'encode_thumbnail', status: 'in_progress' },
        { fileId, type: 'encode_optimised', status: 'in_progress' },
      ]);

      // Check if encoded files already exist on disk (DB may have been reset)
      // Also check if quality matches current settings - if not, need to re-encode
      let existingVariants:
        | {
            thumbPath: string;
            optPath: string;
            thumbQuality: number | undefined;
            optQuality: number | undefined;
          }
        | undefined;
      if (variantsPath) {
        const pathHash = getFileStableHash(file);
        const destDir = join(variantsPath, 'images', pathHash);
        const base = basename(file.name, extname(file.name));
        const thumbPath = join(destDir, `${base}__thumb.avif`);
        const optPath = join(destDir, `${base}__opt.avif`);
        if (existsSync(thumbPath) && existsSync(optPath)) {
          logger.info(`[encode] found existing encoded files on disk for image id=${fileId}`);
          existingVariants = {
            thumbPath,
            optPath,
            thumbQuality: fileResult.thumbnail?.quality ?? undefined,
            optQuality: fileResult.optimized?.quality ?? undefined,
          };
        }
      }

      await encodeImage(file, existingVariants);
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'encode_thumbnail', status: 'succeeded' },
        { fileId, type: 'encode_optimised', status: 'succeeded' },
      ]);
      return { type: 'image', status: 'success' };
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
      return { type: 'image', status: 'failed' };
    }
  }

  if (file.type === 'video') {
    try {
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'video_poster', status: 'in_progress' },
        { fileId, type: 'encode_optimised', status: 'in_progress' },
      ]);

      // Check if encoded files already exist on disk (DB may have been reset)
      let existingVideoVariants: { thumbPath: string; optPath: string } | undefined;
      if (variantsPath) {
        const pathHash = getFileStableHash(file);
        const destDir = join(variantsPath, 'videos', pathHash);
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
      return { type: 'video', status: 'success' };
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
      return { type: 'video', status: 'failed' };
    }
  }

  return null;
}

// Parse time from FFmpeg stderr output (format: time=00:05:32.42)
// Finds the LAST occurrence to get the most recent progress
function parseFfmpegTime(stderr: string): number | null {
  // Find all time matches and use the last one (most recent progress)
  const timeMatches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (timeMatches.length === 0) return null;

  const lastMatch = timeMatches[timeMatches.length - 1];
  if (!lastMatch || !lastMatch[1] || !lastMatch[2] || !lastMatch[3]) return null;

  const hours = parseInt(lastMatch[1], 10);
  const minutes = parseInt(lastMatch[2], 10);
  const seconds = parseFloat(lastMatch[3]);
  return hours * 3600 + minutes * 60 + seconds;
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

async function runFfmpegWithProgress(
  args: string[],
  label: string,
  durationSeconds: number,
  onProgress: (percent: number) => void | Promise<void>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    logger.debug(`[ffmpeg:${label}] spawn with progress tracking ${args.join(' ')}`);
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let lastReportedPercent = -1;

    child.stderr.on('data', async (d) => {
      const chunk = String(d);
      stderr += chunk;

      // Parse progress from FFmpeg output
      const currentTime = parseFfmpegTime(stderr);
      if (currentTime !== null && durationSeconds > 0) {
        const percent = Math.min(
          100,
          Math.max(0, Math.round((currentTime / durationSeconds) * 100)),
        );
        // Only report every 5% to avoid excessive API calls
        if (percent !== lastReportedPercent && percent % 5 === 0) {
          lastReportedPercent = percent;
          try {
            await onProgress(percent);
          } catch (e) {
            // Ignore progress reporting errors
          }
        }
      }
    });

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
  const variantsPath = settings?.variantsPath ?? settings?.uploadPath;
  if (!variantsPath) {
    throw new Error('variantsPath missing from settings');
  }

  const inputPath = toContainerPath(join(file.dir, file.name));

  // Use path hash for stable folder naming across DB resets
  const pathHash = getFileStableHash(file);
  const destDir = join(variantsPath, 'videos', pathHash);
  await mkdir(destDir, { recursive: true });

  const base = basename(file.name, extname(file.name));
  const thumbName = `${base}__thumb.jpg`;
  const optName = `${base}__opt.mp4`;
  const thumbPath = join(destDir, thumbName);
  const optPath = join(destDir, optName);

  // Extract metadata (width/height, duration, takenAt, geo) from source video
  const { width, height, duration, takenAt, lat, lon, cameraMake, cameraModel, lensModel } =
    await getVideoMetadata(inputPath);

  let thumbSize: number;
  let optSize: number;

  // If variants already exist on disk, reuse them instead of re-encoding
  if (existingVariants) {
    logger.info(`[encode:video] reusing existing variants on disk for id=${file.id}`);
    const [thumbStat, optStat] = await Promise.all([
      stat(existingVariants.thumbPath),
      stat(existingVariants.optPath),
    ]);
    thumbSize = thumbStat.size;
    optSize = optStat.size;
  } else {
    // Optimised MP4 (H.264/AAC, faststart, max 1080p, yuv420p)
    // Use progress tracking if we have duration
    logger.info(
      `[encode:video] starting transcode id=${file.id} duration=${duration ?? 'unknown'}s gpu=${settings?.gpuEncoding ?? false}`,
    );

    const reportProgress = async (percent: number) => {
      logger.debug(`[encode:video] progress id=${file.id} ${percent}%`);
      await trpc.fileTask.setProgress.mutate({
        fileId: file.id,
        type: 'encode_optimised',
        progress: percent,
      });
    };

    // Try GPU encoding if enabled, fall back to CPU
    const useGpu = settings?.gpuEncoding ?? false;
    const selectedGpu = settings?.selectedGpu ?? null;
    let gpuFailed = false;

    // Determine encoder based on selected GPU
    const getEncoderCodec = (): { codec: string; name: string } => {
      if (!selectedGpu || selectedGpu === 'cpu') {
        return { codec: 'libx264', name: 'CPU' };
      }
      if (selectedGpu.startsWith('nvidia:')) {
        return { codec: 'h264_nvenc', name: 'NVENC' };
      }
      if (selectedGpu === 'vaapi') {
        return { codec: 'h264_vaapi', name: 'VAAPI' };
      }
      if (selectedGpu === 'videotoolbox') {
        return { codec: 'h264_videotoolbox', name: 'VideoToolbox' };
      }
      // Default to NVENC if GPU enabled but no specific selection
      return { codec: 'h264_nvenc', name: 'NVENC' };
    };

    const encoder = getEncoderCodec();

    if (useGpu && encoder.codec !== 'libx264') {
      try {
        logger.info(`[encode:video] attempting ${encoder.name} GPU encoding id=${file.id} gpu=${selectedGpu}`);

        // Base arguments for all encoders
        const baseArgs = [
          '-y',
          '-i',
          inputPath,
          '-c:v',
          encoder.codec,
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
        ];

        // Add encoder-specific options
        if (encoder.codec === 'h264_nvenc') {
          baseArgs.splice(5, 0, '-preset', 'p4', '-cq', '23');
        } else if (encoder.codec === 'h264_vaapi') {
          baseArgs.splice(5, 0, '-qp', '23');
        } else if (encoder.codec === 'h264_videotoolbox') {
          baseArgs.splice(5, 0, '-b:v', '5M');
        }

        if (duration && duration > 0) {
          await runFfmpegWithProgress(baseArgs, `optimise-${encoder.name.toLowerCase()}`, duration, reportProgress);
        } else {
          await runFfmpeg(baseArgs, `optimise-${encoder.name.toLowerCase()}`);
        }
        logger.info(`[encode:video] ${encoder.name} encoding successful id=${file.id}`);
      } catch (e) {
        logger.warn(
          `[encode:video] ${encoder.name} encoding failed, falling back to CPU id=${file.id}`,
          e as Error,
        );
        gpuFailed = true;
      }
    }

    // CPU encoding (fallback or if GPU not enabled)
    if (!useGpu || gpuFailed) {
      if (duration && duration > 0) {
        await runFfmpegWithProgress(
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
          duration,
          reportProgress,
        );
      } else {
        // Fallback to non-progress tracking for unknown duration
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
      }
    }

    // Poster frame (first frame), scaled to width 320px
    await runFfmpeg(
      ['-y', '-i', inputPath, '-frames:v', '1', '-vf', "scale='320':'-2'", '-q:v', '2', thumbPath],
      'thumbnail',
    );

    const [thumbStat, optStat] = await Promise.all([stat(thumbPath), stat(optPath)]);
    thumbSize = thumbStat.size;
    optSize = optStat.size;
  }

  // Generate blurhash from the poster frame using Sharp's file path input
  let blurhash: string | null = null;
  try {
    const smallImg = await sharp(thumbPath)
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
  const validatedCamera = validateCamera(cameraMake ?? null, cameraModel ?? null);
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
      cameraMake: validatedCamera.isValid ? validatedCamera.cameraMake : null,
      cameraModel: validatedCamera.isValid ? validatedCamera.cameraModel : null,
      lensModel: lensModel ?? null,
    });
  }

  // Save geo location if available
  if (lat != null && lon != null) {
    try {
      logger.debug(`[encode:video] saving geolocation id=${file.id} lat=${lat} lon=${lon}`);
      await trpc.geoLocation.save.mutate({ fileId: file.id, lat, lon });
    } catch (e) {
      logger.warn('Failed to save geo location', { fileId: file.id, error: e });
    }
  }
}
