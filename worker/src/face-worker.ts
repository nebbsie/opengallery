import { join } from 'node:path';
import pLimit from 'p-limit';
import { detectFaces } from './face-detection/detect.js';
import { createFaceCrop } from './face-detection/face-crop.js';
import { faceServiceHealthy } from './face-detection/face-client.js';
import { logger } from './utils/logger.js';
import { toContainerPath } from './utils/paths.js';
import { trpc } from './utils/trpc.js';

// Regenerate missing avatar crops from already-stored face boxes (no detection /
// embedding work). Clears the backlog of faces whose crop failed previously.
async function backfillCrops(): Promise<void> {
  let settings;
  try {
    settings = await trpc.settings.get.query();
  } catch {
    return;
  }
  const variantsPath = settings?.variantsPath ?? settings?.uploadPath ?? null;
  if (!variantsPath) return;

  let cursor: string | undefined;
  let done = 0;
  while (true) {
    const faces = await trpc.faces.listFacesMissingCrop.query({ limit: 50, cursor });
    if (faces.length === 0) break;
    for (const f of faces) {
      try {
        const fileResult = await trpc.files.getFileById.query(f.fileId);
        const file = fileResult.raw;
        const sourcePath = toContainerPath(join(file.dir, file.name));
        const crop = await createFaceCrop({
          faceId: f.faceId,
          sourcePath,
          box: { x: f.boxX, y: f.boxY, width: f.boxW, height: f.boxH },
          variantsPath,
        });
        if (crop) {
          await trpc.faces.setFaceCrop.mutate({
            faceId: f.faceId,
            cropDir: crop.cropDir,
            cropName: crop.cropName,
          });
          done++;
        }
      } catch (e) {
        logger.warn(`[face-detection] crop backfill failed for face ${f.faceId}`, e as Error);
      }
    }
    // Keyset-advance past this page (including any that failed) to guarantee progress.
    cursor = faces[faces.length - 1]?.faceId;
  }
  if (done > 0) logger.info(`[face-detection] backfilled ${done} avatar crop(s)`);
}

// Face detection runs in its own loop so it never competes with the encode loop
// for its concurrency budget. Low default concurrency keeps memory/CPU sane; it
// follows the faceConcurrency setting.
const DEFAULT_FACE_CONCURRENCY = 2;

export function runFaceWorker(): void {
  let limit = pLimit(DEFAULT_FACE_CONCURRENCY);
  let currentConcurrency = DEFAULT_FACE_CONCURRENCY;

  const loop = async () => {
    // Wait for the InsightFace sidecar to finish loading its model before we
    // start leasing work, so the first batch doesn't fail against a cold service.
    logger.info('[face-detection] waiting for face-service to become ready...');
    while (!(await faceServiceHealthy())) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    logger.info('[face-detection] face-service ready');

    // Backfill avatar crops for faces detected before crops worked. Runs in the
    // background so it doesn't hold up the detection loop.
    void backfillCrops().catch((e) =>
      logger.warn('[face-detection] crop backfill pass failed', e as Error),
    );

    // Seed detect_faces tasks for the existing library once on boot (idempotent).
    try {
      const { seeded, purged, revived } = await trpc.faces.backfillDetectTasks.mutate();
      if (seeded || purged || revived)
        logger.info(`[face-detection] backfill: seeded=${seeded} purged=${purged} revived=${revived}`);
    } catch (e) {
      logger.warn('[face-detection] backfill failed', e as Error);
    }

    while (true) {
      try {
        const fileIds = await trpc.fileTask.leaseFilesForFaceDetection.mutate();
        if (fileIds.length === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        try {
          const settings = await trpc.settings.get.query();
          const next = Math.max(1, Math.min(16, settings?.faceConcurrency ?? DEFAULT_FACE_CONCURRENCY));
          if (next !== currentConcurrency) {
            logger.info(`[face-detection] concurrency ${currentConcurrency} -> ${next}`);
            currentConcurrency = next;
            limit = pLimit(next);
          }
        } catch {
          // keep current concurrency on settings failure
        }

        await Promise.allSettled(
          fileIds.map((fileId: string) => limit(() => detectFaces(fileId))),
        );
      } catch (e) {
        logger.error('[face-detection] lease loop error', e as Error);
        const jitter = Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, 1000 + jitter));
      }
    }
  };

  void loop();
}
