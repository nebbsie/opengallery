import 'dotenv/config';
import { logger } from './utils/logger.js';
import { runWatcher } from './watcher.js';
import { runWorker } from './worker.js';

async function main() {
  logger.info('OpenGallery worker starting...');

  try {
    runWorker();
  } catch (e) {
    logger.error('[worker] failed to start', e as Error);
  }

  try {
    await runWatcher();
  } catch (e) {
    logger.error('[watcher] failed to start', e as Error);
  }
}

main();

// Keep process alive on unexpected errors; log and continue
process.on('unhandledRejection', (reason) => {
  logger.error('[worker] Unhandled promise rejection', reason as Error);
});

process.on('uncaughtException', (err) => {
  logger.error('[worker] Uncaught exception', err);
});
