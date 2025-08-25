import { Logger } from '@opengallery/logger';
import chokidar from 'chokidar';
import { scan } from './scanner.js';
import { trpc } from './trpc.js';

interface WatchedPath {
  id: string;
  path: string;
  watcher: chokidar.FSWatcher;
}

export class FileWatcherService {
  private watchers = new Map<string, WatchedPath>();
  private isInitialized = false;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async initialize() {
    if (this.isInitialized) {
      this.logger.info('FileWatcherService already initialized');
      return;
    }

    // Get initial paths all users
    const usersPaths = await trpc.mediaSourcesSettings.getAll.query();

    // Setup watchers for all users, existing paths
    for (const userPath of usersPaths) {
      const paths = userPath.paths;
      for (const path of paths) {
        await this.addWatcher(path.id, path.path, path.userId);
      }
    }

    this.isInitialized = true;
  }

  async addWatcher(id: string, path: string, userId: string) {
    if (this.watchers.has(id)) {
      this.logger.info(`Watcher for path ${id} already exists, removing old one`);

      await this.removeWatcher(id);
    }

    this.logger.info(`Adding watcher for path: ${path} (ID: ${id})`);

    // Do initial scan, but don't crash if path is missing or unreadable.
    try {
      await scan(path, userId);
    } catch (error: unknown) {
      this.logger.error(`Initial scan failed for ${path} because: ${error}`);
    }

    // Setup watcher.
    try {
      const watcher = chokidar.watch(path, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100,
        },
        ignored: [
          /(^|[\/\\])\../, // Hidden files
          /\.DS_Store$/, // macOS
          /Thumbs\.db$/, // Windows
          /\.tmp$/, // Temporary files
          /\.log$/, // Log files
        ],
      });

      // Setup event listeners
      // watcher
      //   .on('add', (filePath) => {
      //     this.logger.info(`File added: ${filePath}`);
      //   })
      //   .on('change', (filePath) => {
      //     this.logger.info(`File changed: ${filePath}`);
      //   })
      //   .on('unlink', (filePath) => {
      //     this.logger.info(`File deleted: ${filePath}`);
      //   })
      //   .on('addDir', (dirPath) => {
      //     this.logger.info(`Directory added: ${dirPath}`);
      //   })
      //   .on('unlinkDir', (dirPath) => {
      //     this.logger.info(`Directory deleted: ${dirPath}`);
      //   })
      //   .on('error', (error) => {
      //     this.logger.error(`Watcher error for ${path}:`, error);
      //   });

      this.watchers.set(id, { id, path, watcher });
    } catch (error) {
      this.logger.error(`Failed to add watcher for ${path}:`, error as Error);
    }
  }

  async removeWatcher(id: string) {
    const watchedPath = this.watchers.get(id);
    if (!watchedPath) {
      this.logger.info(`No watcher found for ID: ${id}`);
      return;
    }

    this.logger.info(`Removing watcher for: ${watchedPath.path} (ID: ${id})`);

    try {
      await watchedPath.watcher.close();
      this.watchers.delete(id);
      this.logger.info(`Successfully removed watcher for: ${watchedPath.path}`);
    } catch (error) {
      this.logger.error(`Error removing watcher for ${watchedPath.path}:`, error as Error);
    }
  }

  async updateWatchers() {
    const usersPaths = await trpc.mediaSourcesSettings.getAll.query();
    const allPaths = usersPaths.flatMap((u) => u.paths);

    const currentPathIds = new Set(allPaths.map((p) => p.id));
    const existingPathIds = new Set(this.watchers.keys());

    // remove stale watchers
    for (const id of existingPathIds) {
      if (!currentPathIds.has(id)) {
        await this.removeWatcher(id);
      }
    }

    // add new watchers
    for (const p of allPaths) {
      if (!this.watchers.has(p.id)) {
        await this.addWatcher(p.id, p.path, p.userId);
      }
    }
  }

  getActiveWatchers() {
    return Array.from(this.watchers.values()).map((w) => ({
      id: w.id,
      path: w.path,
    }));
  }

  async shutdown() {
    this.logger.info('Shutting down FileWatcherService...');

    const closePromises = Array.from(this.watchers.values()).map(async (watchedPath) => {
      try {
        await watchedPath.watcher.close();
        this.logger.info(`Closed watcher for: ${watchedPath.path}`);
      } catch (error) {
        this.logger.error(`Error closing watcher for ${watchedPath.path}:`, error as Error);
      }
    });

    await Promise.all(closePromises);
    this.watchers.clear();
    this.isInitialized = false;
    this.logger.info('FileWatcherService shutdown complete');
  }
}
