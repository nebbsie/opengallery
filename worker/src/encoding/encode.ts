import { encode as encodeBlurhash } from 'blurhash';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import { validateCamera } from '../utils/camera-validator.js';
import { getExifInfo } from '../utils/exif.js';
import { isRawName, needsPreview } from '../utils/media-types.js';
import { getRawPreview, NoRawPreviewError } from '../utils/raw.js';
import { getVideoMetadata } from '../utils/ffprobe.js';
import { throttleIo } from '../utils/io-throttle.js';
import { logger } from '../utils/logger.js';
import { toContainerPath } from '../utils/paths.js';
import { type RouterOutputs, trpc } from '../utils/trpc.js';

type File = RouterOutputs['files']['getFileById']['raw'];
type EncodeStatus = 'success' | 'failed';
type EncodeResult = { type: 'image' | 'video'; status: EncodeStatus };

// Open an image tolerantly. Real-world libraries contain truncated / slightly
// corrupt JPEGs (e.g. "VipsJpeg: Invalid SOS parameters for sequential JPEG").
// libvips defaults to failOn:'warning', which aborts on these; 'none' lets it
// decode whatever valid scan data exists so we still get a usable variant
// instead of permanently failing the file.
function openImage(input: string | Buffer): sharp.Sharp {
  return sharp(input, { failOn: 'none' });
}

// Thrown when an image cannot be decoded by libvips OR the ffmpeg fallback.
// The caller marks the task terminally skipped rather than failed, so an
// unrecoverable file stops consuming retries forever.
class UndecodableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UndecodableImageError';
  }
}

// Single-frame decode of one image. Generous for a slow USB read.
const FFMPEG_DECODE_TIMEOUT_MS = 2 * 60 * 1000;
// ffmpeg prints progress to stderr about twice a second. If it makes no
// progress for this long it is hung (stuck on a dead USB read, or a status
// line that repeats "frame=0" forever); kill it so one bad file cannot stall
// the encode batch, and with it the whole encode loop.
const FFMPEG_STALL_TIMEOUT_MS = 5 * 60 * 1000;
// Keep only the tail of stderr for error messages.
const FFMPEG_STDERR_MAX = 16 * 1024;

// Last-resort decode for images libvips rejects. ffmpeg's mjpeg decoder is far
// more tolerant of truncated / malformed JPEGs; we ask it to emit a single
// clean PNG frame to stdout, which sharp can then re-encode normally. Returns
// null if ffmpeg also can't recover a frame.
async function ffmpegDecodeToPng(path: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-v', 'error',
      '-err_detect', 'ignore_err',
      '-i', path,
      '-frames:v', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      'pipe:1',
    ];
    // stderr is ignored, not piped: nothing read the pipe, so a corrupt file
    // that logs more than the pipe buffer of errors blocked ffmpeg forever.
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, FFMPEG_DECODE_TIMEOUT_MS);
    child.stdout.on('data', (d) => chunks.push(d as Buffer));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      resolve(code === 0 && buf.length > 0 ? buf : null);
    });
  });
}

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

// The 640 px grid thumbnail ("thumbnail_lg"). Aspect is kept (no crop) so a
// justified grid can show the whole photo, and 640 on the short side keeps a
// ~320 CSS px tile sharp on a 2x screen. Very wide or tall images are capped
// at 1920 on the long side instead so a panorama does not become a huge file.
const LG_SHORT_SIDE = 640;
const LG_LONG_CAP = 1920;
function lgResizeOptions(width: number | null, height: number | null): sharp.ResizeOptions {
  if (width && height && Math.max(width, height) / Math.min(width, height) > LG_LONG_CAP / LG_SHORT_SIDE) {
    return { width: LG_LONG_CAP, height: LG_LONG_CAP, fit: 'inside', withoutEnlargement: true };
  }
  return { width: LG_SHORT_SIDE, height: LG_SHORT_SIDE, fit: 'outside', withoutEnlargement: true };
}

// Render the large thumbnail from the optimised variant (already rotated and
// at most 4096 px), so it never needs another read of the original file.
async function renderLargeThumb(optData: Buffer, quality: number): Promise<Buffer> {
  const meta = await openImage(optData).metadata();
  return openImage(optData)
    .resize(lgResizeOptions(meta.width ?? null, meta.height ?? null))
    .avif({ quality, effort: 4 })
    .toBuffer();
}

function largeThumbName(file: File): string {
  return `${basename(file.name, extname(file.name))}__thumb640.avif`;
}

/**
 * Backfill path: the file already has its 320 px thumbnail and optimised
 * variant but no large thumbnail. Make only that one. Returns false when the
 * optimised file is not on disk, so the caller can fall back to a full encode.
 */
async function encodeLargeThumbOnly(
  file: File,
  variantsPath: string,
  quality: number,
): Promise<boolean> {
  const destDir = join(variantsPath, 'images', getFileStableHash(file));
  const base = basename(file.name, extname(file.name));
  const optPath = join(destDir, `${base}__opt.avif`);
  if (!existsSync(optPath)) return false;
  const lgName = largeThumbName(file);
  const lgPath = join(destDir, lgName);
  let data: Buffer;
  if (existsSync(lgPath)) {
    data = await throttleIo(() => readFile(lgPath));
  } else {
    const optData = await throttleIo(() => readFile(optPath));
    data = await renderLargeThumb(optData, quality);
    await throttleIo(() => writeFile(lgPath, data));
  }
  await trpc.files.saveVariants.mutate({
    originalFileId: file.id,
    variants: [
      {
        type: 'thumbnail_lg',
        fileType: 'image',
        dir: destDir,
        name: lgName,
        mime: 'image/avif',
        size: data.length,
        quality,
      },
    ],
  });
  return true;
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
  const originalPath = toContainerPath(hostPath);
  const fileId = file.id;
  // A camera RAW is decoded from its embedded JPEG preview, a HEIC from an
  // ffmpeg decode (both cached and already upright); the tags still come from
  // the original file.
  const isRaw = needsPreview(file.name);
  let path = originalPath;
  if (isRaw) {
    try {
      path = await getRawPreview(file, variantsPath);
    } catch (e) {
      if (e instanceof NoRawPreviewError) throw new UndecodableImageError(e.message);
      throw e;
    }
  }

  // Tags first, before any variant is saved: for a RAW a read error (flaky USB
  // drive) throws here, so the task fails and is retried. Once the variants
  // exist the encode is not run again, and the photo would keep no date.
  const exif = await getExifInfo(originalPath);
  timings['exif'] = Date.now() - stepStart;
  stepStart = Date.now();

  // Extract metadata (width/height) early using sharp. Tolerant: a corrupt
  // header shouldn't hard-fail here before the thumbnail step gets a chance to
  // recover the image via ffmpeg, so fall back to unknown dimensions.
  let width: number | null = null;
  let height: number | null = null;
  try {
    const metadata = await openImage(path).metadata();
    width = metadata.width ?? null;
    height = metadata.height ?? null;
    // metadata() reports stored (pre-rotation) dims, but the variants are
    // auto-rotated. EXIF orientations 5-8 swap the axes.
    if ((metadata.orientation ?? 1) >= 5) {
      [width, height] = [height, width];
    }
  } catch (e) {
    logger.warn(`[encode:image] metadata read failed for id=${fileId}`, e as Error);
  }
  timings['metadata'] = Date.now() - stepStart;
  stepStart = Date.now();

  // Generate blurhash from a small version of the image
  let blurhash: string | null = null;
  try {
    const smallImg = await openImage(path)
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

    // Render thumbnail + optimised from a sharp source. The fast path streams
    // straight from the original file (memory efficient for large RAW/JPEG); the
    // source factory is swapped to a repaired in-memory buffer on the fallback.
    const renderThumb = (src: () => sharp.Sharp) =>
      src()
        .rotate()
        .resize({ width: 320, height: 320, fit: 'cover', withoutEnlargement: true })
        .avif({ quality: thumbQuality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
    const renderOpt = (src: () => sharp.Sharp) =>
      src()
        .rotate()
        .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
        .avif({ quality: optQuality, effort: 3 })
        .toBuffer({ resolveWithObject: true });

    let thumbResult: { data: Buffer };
    let optResult: { data: Buffer };
    try {
      thumbResult = await renderThumb(() => openImage(path));
      optResult = await renderOpt(() => openImage(path));
    } catch (e) {
      // libvips couldn't decode it even with failOn:'none'. Try to recover a
      // clean frame via ffmpeg; if that also fails the file is unrecoverable.
      logger.warn(
        `[encode:image] libvips decode failed for id=${fileId}, attempting ffmpeg repair`,
        e as Error,
      );
      const repaired = await ffmpegDecodeToPng(path);
      if (!repaired) {
        throw new UndecodableImageError((e as Error)?.message ?? 'decode failed');
      }
      thumbResult = await renderThumb(() => openImage(repaired));
      optResult = await renderOpt(() => openImage(repaired));
      logger.info(`[encode:image] recovered via ffmpeg for id=${fileId}`);
    }
    thumb = { data: thumbResult.data, info: { size: thumbResult.data.length } };
    opt = { data: optResult.data, info: { size: optResult.data.length } };
    timings['thumbnail'] = Date.now() - stepStart;
    stepStart = Date.now();

    // Write files sequentially with I/O throttling to reduce disk pressure
    await throttleIo(() => writeFile(thumbPath, thumb.data));
    await throttleIo(() => writeFile(optPath, opt.data));
    timings['write_files'] = Date.now() - stepStart;
    stepStart = Date.now();
  }

  // Large grid thumbnail, from the optimised render in memory. Reused from
  // disk when it is there and the qualities did not change. A failure here
  // must not fail the encode: the grid falls back to the 320 px thumbnail.
  const lgName = largeThumbName(file);
  const lgPath = join(destDir, lgName);
  let lg: Buffer | null = null;
  try {
    if (existingVariants && !needsReencode && existsSync(lgPath)) {
      lg = await throttleIo(() => readFile(lgPath));
    } else {
      lg = await renderLargeThumb(opt.data, thumbQuality);
      const lgData = lg;
      await throttleIo(() => writeFile(lgPath, lgData));
    }
  } catch (e) {
    lg = null;
    logger.warn(`[encode:image] large thumbnail failed for id=${fileId}`, e as Error);
  }
  timings['thumbnail_lg'] = Date.now() - stepStart;
  stepStart = Date.now();

  logger.debug(
    `[encode:image] saving variants for id=${fileId} thumbBytes=${thumb.data.length} optBytes=${opt.data.length}`,
  );
  await trpc.files.saveVariants.mutate({
    originalFileId: fileId, // aligns with procedure definition
    variants: [
      ...(lg
        ? [
            {
              type: 'thumbnail_lg' as const,
              fileType: 'image' as const,
              dir: destDir,
              name: lgName,
              mime: 'image/avif',
              size: lg.length,
              quality: thumbQuality,
            },
          ]
        : []),
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
    width: rawWidth,
    height: rawHeight,
  } = exif;
  // A RAW's preview can be smaller than the sensor: store the real size.
  if (isRawName(file.name) && rawWidth && rawHeight) {
    width = rawWidth;
    height = rawHeight;
  }
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
    // Older files have no large grid thumbnail; the API backfill re-queues
    // them. Make only that variant, from the optimised file on disk.
    if (!fileResult.thumbnailLg && variantsPath && file.mime !== 'image/svg+xml') {
      let done = false;
      try {
        done = await encodeLargeThumbOnly(file, variantsPath, thumbQuality);
      } catch (e) {
        logger.warn(`[encode] large thumbnail backfill failed id=${fileId}`, e as Error);
        // Do not retry forever: the 320 px thumbnail still works.
        done = true;
      }
      if (done) {
        await trpc.fileTask.setManyStatusByFileAndType.mutate([
          { fileId, type: 'encode_thumbnail', status: 'succeeded' },
          { fileId, type: 'encode_optimised', status: 'succeeded' },
        ]);
        logger.info(`[encode] [image:lg] ${fileId} | ${Date.now() - startedAt}ms`);
        return { type: 'image', status: 'success' };
      }
      // Optimised file missing on disk: fall through to a full encode below.
    } else {
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'encode_thumbnail', status: 'succeeded' },
        { fileId, type: 'encode_optimised', status: 'succeeded' },
      ]);
      logger.info(`[encode] [image] ${fileId} | ${Date.now() - startedAt}ms`);
      return { type: 'image', status: 'success' };
    }
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
      // An image that neither libvips nor ffmpeg can decode is unrecoverable —
      // mark it terminally `skipped` (not `failed`) so it never re-enters the
      // retry/revive cycle. Everything else stays `failed` and retries normally.
      const undecodable = e instanceof UndecodableImageError;
      const status = undecodable ? ('skipped' as const) : ('failed' as const);
      if (undecodable) {
        logger.warn(`[encode] image undecodable, skipping fileId=${fileId}`, e as Error);
      } else {
        logger.error(`[encode] image failed fileId=${fileId}`, e as Error);
      }
      try {
        await trpc.fileTask.setManyStatusByFileAndType.mutate([
          {
            fileId,
            type: 'encode_thumbnail',
            status,
            error: (e as Error)?.message,
            incrementAttempts: !undecodable,
          },
          {
            fileId,
            type: 'encode_optimised',
            status,
            error: (e as Error)?.message,
            incrementAttempts: !undecodable,
          },
        ]);
      } catch (statusErr) {
        logger.error('[encode] failed to mark image tasks', statusErr as Error);
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
    const stall = armStallTimer(child, label, reject);
    child.stderr.on('data', (d) => {
      const chunk = String(d);
      stall.progress(chunk);
      stderr = (stderr + chunk).slice(-FFMPEG_STDERR_MAX);
    });
    child.on('close', (code) => {
      stall.clear();
      if (code === 0) return resolve();
      logger.error(`[ffmpeg:${label}] failed code=${code} stderr=${stderr}`);
      reject(new Error(`ffmpeg ${label} failed (code ${code}): ${stderr}`));
    });
    child.on('error', (err) => {
      stall.clear();
      reject(err);
    });
  });
}

// Kill ffmpeg and reject if it makes no progress for FFMPEG_STALL_TIMEOUT_MS.
// Output counts as progress unless it is a status line ("frame=... time=...")
// that says the same as the last one: a hung encode keeps printing those.
// Rejects at once rather than on 'close', because a process stuck in an
// uninterruptible read may not exit after SIGKILL until the I/O returns.
function armStallTimer(
  child: ReturnType<typeof spawn>,
  label: string,
  reject: (err: Error) => void,
) {
  let timer: NodeJS.Timeout | undefined;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      logger.error(`[ffmpeg:${label}] no output for ${FFMPEG_STALL_TIMEOUT_MS}ms, killing`);
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg ${label} stalled`));
    }, FFMPEG_STALL_TIMEOUT_MS);
  };
  reset();
  let lastStatus = '';
  const progress = (chunk: string) => {
    const lines = chunk.split(/[\r\n]+/).filter((l) => l.includes('frame=') || l.includes('size='));
    if (lines.length === 0) return reset();
    const status = lines[lines.length - 1]!.replace(/\s*(fps|speed|elapsed)=\s*\S+/g, '').trim();
    if (status !== lastStatus) {
      lastStatus = status;
      reset();
    }
  };
  return { progress, clear: () => clearTimeout(timer) };
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
    const stall = armStallTimer(child, label, reject);

    child.stderr.on('data', async (d) => {
      const chunk = String(d);
      stall.progress(chunk);
      // Bounded tail: the full stderr of a long encode is megabytes, and
      // re-scanning all of it on every chunk was quadratic.
      stderr = (stderr + chunk).slice(-FFMPEG_STDERR_MAX);

      // Parse progress from FFmpeg output
      const currentTime = parseFfmpegTime(chunk);
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
      stall.clear();
      if (code === 0) return resolve();
      logger.error(`[ffmpeg:${label}] failed code=${code} stderr=${stderr}`);
      reject(new Error(`ffmpeg ${label} failed (code ${code}): ${stderr}`));
    });

    child.on('error', (err) => {
      stall.clear();
      reject(err);
    });
  });
}

async function encodeVideo(file: File, existingVariants?: { thumbPath: string; optPath: string }) {
  const settings = await trpc.settings.get.query();
  const variantsPath = settings?.variantsPath ?? settings?.uploadPath;
  if (!variantsPath) {
    throw new Error('variantsPath missing from settings');
  }

  let inputPath = toContainerPath(join(file.dir, file.name));

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
          "scale='trunc(min(1920,iw)/2)*2':'-2'",
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
          // VAAPI encodes GPU surfaces: open the render node, decode on the
          // CPU, then upload NV12 frames (a software pix_fmt here makes
          // h264_vaapi fail and every video fall back to the CPU).
          const device = process.env['VAAPI_DEVICE'] ?? '/dev/dri/renderD128';
          baseArgs.splice(1, 0, '-vaapi_device', device);
          const pix = baseArgs.indexOf('-pix_fmt');
          if (pix >= 0) baseArgs.splice(pix, 2);
          const vf = baseArgs.indexOf('-vf');
          if (vf >= 0) baseArgs[vf + 1] = `${baseArgs[vf + 1]},format=nv12,hwupload`;
          baseArgs.splice(baseArgs.indexOf('-c:v') + 2, 0, '-qp', '23');
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

    // The folder may have been renamed while the GPU encode ran: open the file
    // at its current path.
    if (gpuFailed) {
      const current = (await trpc.files.getFileById.query(file.id))?.raw;
      if (current) inputPath = toContainerPath(join(current.dir, current.name));
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
            "scale='trunc(min(1920,iw)/2)*2':'-2'",
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
            "scale='trunc(min(1920,iw)/2)*2':'-2'",
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

  // Large poster (640 px wide) for the grid, from the optimised MP4 on local
  // disk. Optional: the grid falls back to the 320 px poster.
  const lgName = `${base}__thumb640.jpg`;
  const lgPath = join(destDir, lgName);
  let lgSize: number | null = null;
  try {
    if (!existsSync(lgPath)) {
      await runFfmpeg(
        ['-y', '-i', optPath, '-frames:v', '1', '-vf', "scale='min(640,iw)':'-2'", '-q:v', '3', lgPath],
        'thumbnail_lg',
      );
    }
    lgSize = (await stat(lgPath)).size;
  } catch (e) {
    logger.warn(`[encode:video] large poster failed for id=${file.id}`, e as Error);
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
      ...(lgSize != null
        ? [
            {
              type: 'thumbnail_lg' as const,
              fileType: 'image' as const,
              dir: destDir,
              name: lgName,
              mime: 'image/jpeg',
              size: lgSize,
            },
          ]
        : []),
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
