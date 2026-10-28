import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { logger } from '../utils/logger.js';

export type NormalizedBox = { x: number; y: number; width: number; height: number };

// When cropping from a file path, decode at most this size (boxes are
// normalized, so any size lines up).
const DECODE_MAX = 2048;
// Avatar crop output size.
const CROP_SIZE = 256;
// Extra context around the detected box (fraction of box size on each side).
const MARGIN = 0.35;

/**
 * Crop a detected face and write it as an AVIF avatar. `source` is a file path
 * (oriented on decode) or an already-oriented image buffer, such as the frame
 * the face was detected in. Returns where it was written, or null on failure
 * (non-fatal for detection).
 */
export async function createFaceCrop(opts: {
  faceId: string;
  source: string | Buffer;
  box: NormalizedBox;
  variantsPath: string;
}): Promise<{ cropDir: string; cropName: string } | null> {
  const { faceId, source, box, variantsPath } = opts;
  try {
    // Materialize the oriented image and read its ACTUAL dimensions, then crop
    // from that same buffer, so the extract can never go out of range.
    const { data, info } =
      typeof source === 'string'
        ? await sharp(source, { failOn: 'none' })
            .rotate()
            .resize({ width: DECODE_MAX, height: DECODE_MAX, fit: 'inside', withoutEnlargement: true })
            .toBuffer({ resolveWithObject: true })
        : await sharp(source, { failOn: 'none' }).toBuffer({ resolveWithObject: true });
    const imgW = info.width;
    const imgH = info.height;
    if (!imgW || !imgH) return null;

    // Box in pixels with margin, clamped to the real image bounds.
    const px = box.x * imgW;
    const py = box.y * imgH;
    const pw = box.width * imgW;
    const ph = box.height * imgH;
    const mx = pw * MARGIN;
    const my = ph * MARGIN;

    // Clamp both edges, not the origin alone: clamping only left/top kept the
    // full width, so a face at the image edge shifted the crop off the face.
    const left = Math.max(0, Math.min(Math.floor(px - mx), imgW - 1));
    const top = Math.max(0, Math.min(Math.floor(py - my), imgH - 1));
    const right = Math.min(imgW, Math.ceil(px + pw + mx));
    const bottom = Math.min(imgH, Math.ceil(py + ph + my));
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);

    const cropDir = join(variantsPath, 'faces');
    const cropName = `${faceId}.avif`;
    await mkdir(cropDir, { recursive: true });

    await sharp(data)
      .extract({ left, top, width, height })
      .resize(CROP_SIZE, CROP_SIZE, { fit: 'cover' })
      .avif({ quality: 80, effort: 3 })
      .toFile(join(cropDir, cropName));

    return { cropDir, cropName };
  } catch (e) {
    logger.warn(`[face-detection] crop failed for face ${faceId}`, e as Error);
    return null;
  }
}
