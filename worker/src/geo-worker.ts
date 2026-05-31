import { join } from 'node:path';
import pLimit from 'p-limit';
import { logger } from './utils/logger.js';
import { toContainerPath } from './utils/paths.js';
import { trpc } from './utils/trpc.js';
import { getExifInfo } from './utils/exif.js';
import { getVideoMetadata } from './utils/ffprobe.js';

// GPS extraction runs in its own loop, decoupled from encoding. Encoding skips
// files whose variants already exist, so geolocation that was added after a file
// was first encoded would never be read. This loop re-reads EXIF / ffprobe tags
// off the ORIGINAL file (cheap, no transcode) and persists any coordinates.
const GEO_CONCURRENCY = 4;

async function processFile(fileId: string): Promise<void> {
  let lat: number | undefined;
  let lon: number | undefined;

  try {
    const fileResult = await trpc.files.getFileById.query(fileId);
    const file = fileResult.raw;
    const sourcePath = toContainerPath(join(file.dir, file.name));

    if (file.type === 'image') {
      ({ lat, lon } = await getExifInfo(sourcePath));
    } else if (file.type === 'video') {
      ({ lat, lon } = await getVideoMetadata(sourcePath));
    }

    if (lat != null && lon != null) {
      // Only mark succeeded once the coordinate is actually persisted. save
      // returns null for out-of-range values; treat that as skipped so we never
      // record a succeeded task with no geo_location row.
      const saved = await trpc.geoLocation.save.mutate({ fileId, lat, lon });
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        {
          fileId,
          type: 'extract_geolocation',
          status: saved ? 'succeeded' : 'skipped',
        },
      ]);
      logger.debug(
        `[geo] ${saved ? 'saved' : 'invalid-coords skip'} id=${fileId} lat=${lat} lon=${lon}`,
      );
    } else {
      // No GPS in the file — terminal, mark skipped so we don't retry forever.
      await trpc.fileTask.setManyStatusByFileAndType.mutate([
        { fileId, type: 'extract_geolocation', status: 'skipped' },
      ]);
    }
  } catch (e) {
    logger.warn(`[geo] extraction failed for fileId=${fileId}`, e as Error);
    await trpc.fileTask.setManyStatusByFileAndType
      .mutate([
        {
          fileId,
          type: 'extract_geolocation',
          status: 'failed',
          error: (e as Error)?.message,
          incrementAttempts: true,
        },
      ])
      .catch(() => {});
  }
}

export function runGeoWorker(): void {
  const limit = pLimit(GEO_CONCURRENCY);

  const loop = async () => {
    // Reconcile the task table once on boot: drop tasks on variant outputs, seed
    // any missing originals, and revive dead tasks so a fix to a systemic failure
    // (e.g. the geo_location upsert constraint) re-drives them automatically.
    try {
      const { seeded, purged, revived, reconciled } =
        await trpc.geoLocation.backfillTasks.mutate();
      if (seeded || purged || revived || reconciled)
        logger.info(
          `[geo] backfill: seeded=${seeded} purged=${purged} revived=${revived} reconciled=${reconciled}`,
        );
    } catch (e) {
      logger.warn('[geo] backfill failed', e as Error);
    }

    while (true) {
      try {
        const files = await trpc.fileTask.leaseFilesForGeolocation.mutate();
        if (files.length === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        await Promise.allSettled(
          files.map((fileId: string) => limit(() => processFile(fileId))),
        );
      } catch (e) {
        logger.error('[geo] lease loop error', e as Error);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };

  void loop();
}
