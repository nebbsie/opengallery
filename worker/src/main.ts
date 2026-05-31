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

  // GPS extraction loop — decoupled from encoding so coordinates are read even
  // when the encode step is skipped (variants already exist). Cheap (no
  // transcode), so a failure here must never take down the encode loop.
  try {
    const { runGeoWorker } = await import('./geo-worker.js');
    runGeoWorker();
  } catch (e) {
    logger.error(
      '[geo] disabled: failed to load (encoding continues)',
      e as Error,
    );
  }

  // Face detection talks to the Python InsightFace sidecar over HTTP. Import it
  // lazily inside try/catch so any startup failure disables only face detection
  // — the encode loop above must keep running regardless.
  try {
    const { runFaceWorker } = await import('./face-worker.js');
    runFaceWorker();
  } catch (e) {
    logger.error(
      '[face-detection] disabled: failed to load (encoding continues)',
      e as Error,
    );
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
