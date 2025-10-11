import { Job, Worker } from 'bullmq';
import { encode } from './encoding/encode.js';
import { setConcurrencyLimit } from './utils/concurrency.js';
import { logger } from './utils/logger.js';
import { trpc } from './utils/trpc.js';

const connection = { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' };

let currentWorker: Worker | null = null;

async function getDesiredConcurrency(): Promise<number> {
  try {
    const settings = await trpc.settings.get.query();
    const value = settings?.encodingConcurrency;
    if (typeof value === 'number' && value >= 1 && value <= 64) return value;
  } catch {
    // ignore
  }
  return 5;
}

async function createOrUpdateWorker(): Promise<void> {
  const desired = await getDesiredConcurrency();

  if (currentWorker && (currentWorker as any).opts?.concurrency === desired) {
    setConcurrencyLimit(desired);
    return; // no change
  }

  if (currentWorker) {
    logger.info('Restarting worker with new concurrency', { desiredConcurrency: desired });
    try {
      await currentWorker.close();
    } catch {
      // ignore
    }
    currentWorker = null;
  }

  currentWorker = new Worker(
    'tasks',
    async (job: Job) => {
      switch (job.name) {
        case 'encode': {
          const fileId = job.data?.fileId;

          if (fileId == null) {
            console.log('Missing fileId in job data');
            break;
          }

          if (typeof fileId !== 'string') {
            console.log('Invalid fileId in job data');
            break;
          }

          try {
            await encode(fileId);
          } catch (error) {
            console.error(error);
          }

          break;
        }
        default: {
          console.log(`Unknown job name: ${job.name}`);
          break;
        }
      }
    },
    { connection, concurrency: desired },
  );
  setConcurrencyLimit(desired);
}

export function runWorker(): void {
  void createOrUpdateWorker();
  // Poll periodically for concurrency changes
  setInterval(() => void createOrUpdateWorker(), 10_000);
}
