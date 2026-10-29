import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { logger } from './logger.js';
import { isHeicName } from './media-types.js';
import { toContainerPath } from './paths.js';

// Camera RAW files (media-types.ts RAW_EXTENSIONS). libvips cannot decode
// them, so the worker uses the full-size JPEG preview the camera embeds in
// every RAW, read with exiftool (Debian package libimage-exiftool-perl, see
// Dockerfile.unified). The preview is turned upright with the RAW's own
// orientation and cached as a plain JPEG under <variantsPath>/raw-previews, so
// encode, face detection and object search read the RAW only once. Nothing is
// ever written next to the originals.

const EXIFTOOL_TIMEOUT_MS = 2 * 60 * 1000;
// JSON with base64 previews; a full-size preview is a few MB.
const EXIFTOOL_MAX_BYTES = 256 * 1024 * 1024;
const PREVIEW_QUALITY = 92;
// One HEIC decode; a 12 MP grid takes about a second.
const HEIC_DECODE_TIMEOUT_MS = 2 * 60 * 1000;

// Thrown only when exiftool read the RAW without an error and found tags but
// no embedded preview. The callers mark the task skipped: retrying cannot
// help. Read errors are plain Errors, so the task is retried.
export class NoRawPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoRawPreviewError';
  }
}

export type RawTags = {
  Orientation?: number;
  Make?: string;
  Model?: string;
  LensModel?: string;
  ISO?: number;
  ExposureTime?: number;
  FNumber?: number;
  FocalLength?: number;
  FocalLengthIn35mmFormat?: number;
  DateTimeOriginal?: string;
  CreateDate?: string;
  ModifyDate?: string;
  GPSLatitude?: number;
  GPSLongitude?: number;
  // "W H" (with -n).
  ImageSize?: string;
  JpgFromRaw?: string;
  PreviewImage?: string;
};

const TAG_ARGS = [
  // The first warning, to tell a short read from a RAW without a preview.
  '-Warning',
  // The RAW's own IFD0. A RAW can hold more than one Orientation tag (the
  // embedded JPEG has its own); the main IFD0 is the camera's answer.
  '-IFD0:Orientation',
  '-Make',
  '-Model',
  '-LensModel',
  '-ISO',
  '-ExposureTime',
  '-FNumber',
  '-FocalLength',
  '-FocalLengthIn35mmFormat',
  '-DateTimeOriginal',
  '-CreateDate',
  '-ModifyDate',
  // Composite tags carry the sign of the N/S and E/W reference.
  '-Composite:GPSLatitude',
  '-Composite:GPSLongitude',
  '-Composite:ImageSize',
];

// Any failure here (exit code, an "Error:" line, no tags at all) is a plain,
// retryable Error: the media drive sits on a flaky USB bridge, and a read error
// must never be taken for "this RAW has no preview" (which skips the photo for
// good). Minor warnings are ignored (-m).
function runExiftool(args: string[]): Promise<RawTags> {
  return new Promise((resolve, reject) => {
    const child = spawn('exiftool', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    let bytes = 0;
    let settled = false;
    const finish = (err: Error | null, tags?: RawTags) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(tags ?? {});
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('exiftool timed out'));
    }, EXIFTOOL_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      bytes += d.length;
      if (bytes > EXIFTOOL_MAX_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('exiftool output too large'));
        return;
      }
      chunks.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      // Keep only the tail for the error message.
      stderr = (stderr + d.toString('utf8')).slice(-2000);
    });
    child.on('error', (e) => {
      const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
      finish(missing ? new Error('exiftool is not installed') : e);
    });
    child.on('close', (code) => {
      const detail = stderr.trim().split('\n').slice(-3).join(' | ');
      if (code !== 0) {
        finish(new Error(`exiftool exited with code ${code}${detail ? `: ${detail}` : ''}`));
        return;
      }
      if (/^Error/m.test(stderr)) {
        finish(new Error(`exiftool: ${detail}`));
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        const parsed = text
          ? (JSON.parse(text) as Array<RawTags & { SourceFile?: string; Warning?: string }>)
          : [];
        const first = parsed[0];
        // A short read shows up as a warning ("Error reading value for ...
        // JpgFromRaw"), not as an exit code.
        const warning = typeof first?.Warning === 'string' ? first.Warning : '';
        if (/error reading|truncated|unexpected end|read error/i.test(warning)) {
          finish(new Error(`exiftool: ${warning}`));
          return;
        }
        // A readable RAW always has the camera make or model.
        if (!first || (!first.Make && !first.Model)) {
          finish(new Error(`exiftool returned no camera tags${warning ? `: ${warning}` : ''}`));
          return;
        }
        delete first.SourceFile;
        delete first.Warning;
        finish(null, first);
      } catch (e) {
        finish(e as Error);
      }
    });
  });
}

/** EXIF tags of a RAW file (no preview). `path` is a container path. */
export function readRawTags(path: string): Promise<RawTags> {
  return runExiftool(['-j', '-n', '-m', '-q', ...TAG_ARGS, path]);
}

function decodeBinary(value: string | undefined): Buffer | null {
  if (typeof value !== 'string' || !value.startsWith('base64:')) return null;
  const buf = Buffer.from(value.slice(7), 'base64');
  // Must be a JPEG (SOI marker).
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;
}

/**
 * The embedded JPEG preview and the tags of a RAW, in one exiftool call.
 * JpgFromRaw is the camera's full-size JPEG; PreviewImage is used when there
 * is no JpgFromRaw, or when it is the bigger one (Canon CR2, Sony ARW).
 */
export async function readRawPreview(path: string): Promise<{ preview: Buffer | null; tags: RawTags }> {
  const tags = await runExiftool(['-j', '-b', '-n', '-m', '-q', '-JpgFromRaw', '-PreviewImage', ...TAG_ARGS, path]);
  const jpgFromRaw = decodeBinary(tags.JpgFromRaw);
  const previewImage = decodeBinary(tags.PreviewImage);
  delete tags.JpgFromRaw;
  delete tags.PreviewImage;
  const preview =
    jpgFromRaw && (!previewImage || jpgFromRaw.length >= previewImage.length)
      ? jpgFromRaw
      : previewImage;
  return { preview, tags };
}

/**
 * Apply an EXIF orientation (1-8) to the pixels. sharp runs flip/flop before
 * the rotation, so the transposed orientations (5, 7) use the opposite angle.
 */
export function applyOrientation(img: sharp.Sharp, orientation: number): sharp.Sharp {
  switch (orientation) {
    case 2:
      return img.flop();
    case 3:
      return img.rotate(180);
    case 4:
      return img.flip();
    case 5:
      return img.rotate(270).flop();
    case 6:
      return img.rotate(90);
    case 7:
      return img.rotate(90).flop();
    case 8:
      return img.rotate(270);
    default:
      return img;
  }
}

// Same stable hash as the variant folders in encoding/encode.ts, and as the
// API's cleanup (api/src/utils/raw-pairing.ts rawPreviewCachePath).
function stableHash(file: { dir: string; name: string; contentHash: string | null }): string {
  if (file.contentHash) return file.contentHash.slice(0, 16);
  return createHash('sha256').update(join(file.dir, file.name)).digest('hex').slice(0, 16);
}

export function rawPreviewPath(
  file: { dir: string; name: string; contentHash: string | null },
  variantsPath: string | null,
): string {
  const root = variantsPath ?? join(tmpdir(), 'opengallery');
  return join(root, 'raw-previews', `${stableHash(file)}.jpg`);
}

const inFlight = new Map<string, Promise<string>>();

/**
 * Decode a HEIC/HEIF to PNG with ffmpeg (it joins the tile grid). Rotation is
 * left off and the EXIF orientation applied later, as for a JPEG: Apple and
 * Samsung write the same turn in EXIF as in the HEIF "irot" box. A decode
 * error is thrown as a plain Error, so the task is retried.
 */
async function decodeHeic(path: string): Promise<{ preview: Buffer | null; tags: RawTags }> {
  const tags = await readRawTags(path);
  const preview = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-noautorotate', '-i', path, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), HEIC_DECODE_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d) => (stderr = (stderr + String(d)).slice(-2000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 0) resolve(buf);
      else reject(new Error(`ffmpeg could not decode the HEIC (code ${code}): ${stderr.trim()}`));
    });
  });
  return { preview, tags };
}

/**
 * Path of an upright JPEG for a RAW file: the embedded preview with the RAW's
 * orientation applied (no orientation tag left, so a later .rotate() is a
 * no-op). Extracted once and cached. Throws NoRawPreviewError when the RAW has
 * no usable preview.
 */
export function getRawPreview(
  file: { dir: string; name: string; contentHash: string | null },
  variantsPath: string | null,
): Promise<string> {
  const target = rawPreviewPath(file, variantsPath);
  if (existsSync(target)) return Promise.resolve(target);
  const running = inFlight.get(target);
  if (running) return running;

  const job = (async () => {
    const source = toContainerPath(join(file.dir, file.name));
    const { preview, tags } = isHeicName(file.name)
      ? await decodeHeic(source)
      : await readRawPreview(source);
    if (!preview) throw new NoRawPreviewError(`No embedded preview in ${file.name}`);
    const data = await applyOrientation(sharp(preview, { failOn: 'none' }), tags.Orientation ?? 1)
      .jpeg({ quality: PREVIEW_QUALITY })
      .toBuffer();
    await mkdir(dirname(target), { recursive: true });
    // Write then rename, so a reader never sees half a file.
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, data);
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    logger.debug(`[raw] cached preview for ${file.name} (${data.length} bytes)`);
    return target;
  })();
  inFlight.set(target, job);
  return job.finally(() => inFlight.delete(target));
}
