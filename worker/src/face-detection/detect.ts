import { join } from 'node:path';
import sharp from 'sharp';
import { logger } from '../utils/logger.js';
import { toContainerPath } from '../utils/paths.js';
import { trpc } from '../utils/trpc.js';
import { createFaceCrop } from './face-crop.js';
import { detectFacesRemote } from './face-client.js';

// Detect at this size (matches face-crop's DETECT_MAX so normalized boxes line up).
const DETECT_MAX = 1024;
// Drop low-confidence detections — they yield noisy embeddings that cluster
// poorly and cause false merges.
const MIN_DET_SCORE = 0.65;
// Drop faces smaller than this fraction of image height — too little signal for
// a reliable embedding, and they create junk clusters.
const MIN_FACE_REL_HEIGHT = 0.05;

/**
 * Run face detection + recognition for one image file. Posts an oriented,
 * downscaled JPEG to the InsightFace sidecar, asks the API to cluster each
 * embedding into a person, then writes an avatar crop. Marks the file's
 * detect_faces task succeeded/failed.
 */
export async function detectFaces(fileId: string): Promise<void> {
  const fileResult = await trpc.files.getFileById.query(fileId);
  const file = fileResult.raw;

  // The lease only hands us images whose encode succeeded, but guard anyway.
  if (file.type !== 'image') {
    await trpc.fileTask.setStatusByFileAndType.mutate({
      fileId,
      type: 'detect_faces',
      status: 'skipped',
    });
    return;
  }

  try {
    const settings = await trpc.settings.get.query();
    const variantsPath = settings?.variantsPath ?? settings?.uploadPath ?? null;

    const sourcePath = toContainerPath(join(file.dir, file.name));

    // Orient + downscale, then JPEG-encode for the sidecar. The detection space
    // dims (info.width/height) are what the returned boxes are relative to, and
    // also what createFaceCrop needs.
    // failOn:'none' so truncated/slightly-corrupt JPEGs still decode (matches
    // the encode pipeline) rather than throwing and failing detection.
    const { data: jpeg, info } = await sharp(sourcePath, { failOn: 'none' })
      .rotate()
      .removeAlpha()
      .resize({ width: DETECT_MAX, height: DETECT_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 95 })
      .toBuffer({ resolveWithObject: true });

    const detW = info.width;
    const detH = info.height;

    const result = await detectFacesRemote(jpeg);

    const faces = result.faces.filter((f) => {
      const relHeight = (f.bbox[3] - f.bbox[1]) / detH;
      return f.detScore >= MIN_DET_SCORE && relHeight >= MIN_FACE_REL_HEIGHT;
    });

    if (faces.length === 0) {
      logger.debug(`[face-detection] no faces in ${fileId}`);
      await trpc.fileTask.setStatusByFileAndType.mutate({
        fileId,
        type: 'detect_faces',
        status: 'succeeded',
      });
      return;
    }

    logger.info(`[face-detection] found ${faces.length} face(s) in ${fileId}`);

    for (const f of faces) {
      const embedding = f.embedding;
      if (embedding.length === 0) continue;

      // Sidecar returns [x1, y1, x2, y2]; convert to normalized x/y/w/h.
      const [x1, y1, x2, y2] = f.bbox;
      const box = {
        x: x1 / detW,
        y: y1 / detH,
        width: (x2 - x1) / detW,
        height: (y2 - y1) / detH,
      };

      const assigned = await trpc.faces.assignFace.mutate({
        fileId,
        embedding,
        box,
        detScore: f.detScore,
      });

      if (variantsPath) {
        const crop = await createFaceCrop({
          faceId: assigned.faceId,
          sourcePath,
          box,
          variantsPath,
        });
        if (crop) {
          await trpc.faces.setFaceCrop.mutate({
            faceId: assigned.faceId,
            cropDir: crop.cropDir,
            cropName: crop.cropName,
          });
        }
      }
    }

    await trpc.fileTask.setStatusByFileAndType.mutate({
      fileId,
      type: 'detect_faces',
      status: 'succeeded',
    });
  } catch (e) {
    logger.error(`[face-detection] failed for fileId=${fileId}`, e as Error);
    await trpc.fileTask.setStatusByFileAndType.mutate({
      fileId,
      type: 'detect_faces',
      status: 'failed',
      error: (e as Error)?.message,
      incrementAttempts: true,
    });
  }
}
