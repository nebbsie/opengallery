import pLimit from 'p-limit';
import { encode } from './encoding/encode.js';
import { logger } from './utils/logger.js';
import { trpc } from './utils/trpc.js';
import { setIoConcurrency } from './utils/io-throttle.js';

// Default concurrency limits - will be overridden by system settings
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_IO_CONCURRENCY = 2;

const API_URL = process.env['API_URL'];
const INTERNAL_TOKEN = process.env['INTERNAL_TOKEN'];

async function reportMetrics(data: {
  durationMs?: number;
  type?: "image" | "video";
  status?: "success" | "failed";
  variantType?: "thumbnail" | "optimized";
  quality?: number;
  queueSize?: number;
}) {
  if (!API_URL) return;
  try {
    await fetch(`${API_URL}/metrics/encode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INTERNAL_TOKEN}`,
      },
      body: JSON.stringify(data),
    });
  } catch (e) {
    // Ignore metrics errors
  }
}

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

        // Fetch current encoding and I/O concurrency from settings
        try {
          const settings = await trpc.settings.get.query();
          const newConcurrency = Math.max(1, Math.min(64, settings?.encodingConcurrency ?? DEFAULT_CONCURRENCY));
          if (newConcurrency !== currentConcurrency) {
            logger.info(`[worker] Updating encoding concurrency from ${currentConcurrency} to ${newConcurrency}`);
            currentConcurrency = newConcurrency;
            limit = pLimit(newConcurrency);
          }

          const newIoConcurrency = Math.max(1, Math.min(10, settings?.ioConcurrency ?? DEFAULT_IO_CONCURRENCY));
          setIoConcurrency(newIoConcurrency);
        } catch (e) {
          // If settings fetch fails, continue with current limits
          logger.warn('[worker] Failed to fetch settings', e as Error);
        }

        // Process leased files with controlled concurrency to prevent memory exhaustion
        await Promise.allSettled(
          files.map((fileId: string) =>
            limit(async () => {
              const startTime = Date.now();
              try {
                const result = await encode(fileId);
                if (result) {
                  await reportMetrics({
                    durationMs: Date.now() - startTime,
                    type: result.type,
                    status: result.status,
                  });
                }
              } catch (e) {
                logger.error(`[worker] encode failed for fileId=${fileId}`, e as Error);
                await reportMetrics({ durationMs: Date.now() - startTime, status: 'failed' });
              }
            })
          ),
        );

        // Report queue size
        try {
          const counts = await trpc.fileTask.getCountsByType.query();
          const pendingCount = counts
            .filter((c: { status: string }) => c.status === 'pending')
            .reduce((sum: number, c: { count: number }) => sum + c.count, 0);
          await reportMetrics({ queueSize: pendingCount });
        } catch (e) {
          // Ignore errors
        }
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
