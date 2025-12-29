import { encode } from './encoding/encode.js';
import { logger } from './utils/logger.js';
import { trpc } from './utils/trpc.js';

export function runWorker(): void {
  let stopFlag = false;

  const loop = async () => {
    while (!stopFlag) {
      try {
        const files = await trpc.fileTask.leaseFilesForEncode.mutate();
        if (files.length === 0) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        // Process leased files concurrently
        await Promise.allSettled(
          files.map(async (fileId) => {
            try {
              await encode(fileId);
            } catch (e) {
              logger.error('encode failed', e as Error);
            }
          }),
        );
      } catch (e) {
        logger.error('lease loop error', e as Error);
        // Backoff with jitter to avoid tight crash loops
        const base = 1000;
        const jitter = Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, base + jitter));
      }
    }
  };
  void loop();
}
