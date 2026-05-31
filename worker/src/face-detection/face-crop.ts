import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { logger } from '../utils/logger.js';

export type NormalizedBox = { x: number; y: number; width: number; height: number };

// Detection runs on an image downscaled to fit within this box; crop coordinates
// are normalized, so we re-apply the same transform here to keep them aligned.
const DETECT_MAX = 1024;
// Avatar crop output size.
const CROP_SIZE = 256;
// Extra context around the detected box (fraction of box size on each side).
const MARGIN = 0.35;

/**
 * Crop a detected face out of the source image and write it as an AVIF avatar.
 * Returns where it was written, or null on failure (non-fatal for detection).
 */
export async function createFaceCrop(opts: {
  faceId: string;
  sourcePath: string;
  box: NormalizedBox;
  variantsPath: string;
}): Promise<{ cropDir: string; cropName: string } | null> {
  const { faceId, sourcePath, box, variantsPath } = opts;
  try {
    // Materialize the oriented + downscaled image and read its ACTUAL dimensions,
    // then crop from that same buffer. Deriving the bounds from the buffer we
    // extract from (rather than dimensions passed in from detection) makes the
    // extract impossible to push out of range — the box is normalized [0..1], so
    // it maps correctly onto whatever the real output size turns out to be.
    const { data, info } = await sharp(sourcePath, { failOn: 'none' })
      .rotate()
      .resize({ width: DETECT_MAX, height: DETECT_MAX, fit: 'inside', withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
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

    let left = Math.floor(px - mx);
    let top = Math.floor(py - my);
    let width = Math.ceil(pw + mx * 2);
    let height = Math.ceil(ph + my * 2);

    left = Math.max(0, Math.min(left, imgW - 1));
    top = Math.max(0, Math.min(top, imgH - 1));
    width = Math.max(1, Math.min(width, imgW - left));
    height = Math.max(1, Math.min(height, imgH - top));

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
