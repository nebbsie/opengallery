import 'dotenv/config';
import { logger } from './utils/logger.js';
import { runWorker } from './worker.js';
import { runWatcher } from './watcher.js';

async function main() {
  logger.info('OpenGallery worker starting...');

  runWorker();
  await runWatcher();
}

main();
