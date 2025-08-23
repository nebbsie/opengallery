import { Logger } from '@opengallery/logger';
import 'dotenv/config';
import { FileWatcherService } from './file-watcher.js';
import { logger } from './logger.js';

const PATH_CHECK_INTERVAL = 30 * 1000;

const fileWatcherService = new FileWatcherService(logger);

async function main() {
  logger.info('OpenGallery worker starting...');

  try {
    await fileWatcherService.initialize();

    setInterval(async () => {
      try {
        await fileWatcherService.updateWatchers();
      } catch (error) {
        logger.error('Error updating watchers:', error as Error);
      }
    }, PATH_CHECK_INTERVAL);

    const activeWatchers = fileWatcherService.getActiveWatchers();
    logger.info(`Active watchers: ${activeWatchers.length}`);
  } catch (error) {
    logger.error('Failed to start worker:', error as Error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await fileWatcherService.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await fileWatcherService.shutdown();
  process.exit(0);
});

main();
