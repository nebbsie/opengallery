import pLimit from 'p-limit';
import { encode } from './encoding/encode.js';
import { logger } from './utils/logger.js';
import { trpc } from './utils/trpc.js';

// Default concurrency limit - will be overridden by system settings
const DEFAULT_CONCURRENCY = 4;

export function runWorker(): void {
  let stopFlag = false;
  let currentConcurrency = DEFAULT_CONCURRENCY;
  let limit = pLimit(currentConcurrency);

  const loop = async () => {
    while (!stopFlag) {
      try {
        const files = await trpc.fileTask.leaseFilesForEncode.mutate();
        if (files.length === 0) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        // Fetch current encoding concurrency from settings and update limiter if changed
        try {
          const settings = await trpc.settings.get.query();
          const newConcurrency = Math.max(1, Math.min(64, settings?.encodingConcurrency ?? DEFAULT_CONCURRENCY));
          if (newConcurrency !== currentConcurrency) {
            logger.info(`[worker] Updating concurrency limit from ${currentConcurrency} to ${newConcurrency}`);
            currentConcurrency = newConcurrency;
            limit = pLimit(newConcurrency);
          }
        } catch (e) {
          // If settings fetch fails, continue with current limit
          logger.warn('[worker] Failed to fetch settings for concurrency', e as Error);
        }

        // Process leased files with controlled concurrency to prevent memory exhaustion
        await Promise.allSettled(
          files.map((fileId: string) =>
            limit(async () => {
              try {
                await encode(fileId);
              } catch (e) {
                logger.error(`[worker] encode failed for fileId=${fileId}`, e as Error);
              }
            })
          ),
        );
      } catch (e) {
        logger.error('[worker] lease loop error', e as Error);
        // Backoff with jitter to avoid tight crash loops
        const base = 1000;
        const jitter = Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, base + jitter));
      }
    }
  };
  void loop();
}
