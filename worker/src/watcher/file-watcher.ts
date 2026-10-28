import { Logger } from '@opengallery/logger';
import chokidar from 'chokidar';
import { lookup as mimeLookup } from 'mime-types';
import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { computeFileHash } from '../utils/hash.js';
import { getMediaType, isSupportedFile, rawMime, type MediaType } from '../utils/media-types.js';
import { toContainerPath, toHostPath } from '../utils/paths.js';
import { trpc, type RouterOutputs } from '../utils/trpc.js';
import { scan } from './scanner.js';

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
      await this.removeWatcher(id);
    }

    // Translate host path to container path if HOST_ROOT_PREFIX is set (Docker); else use as-is.
    const containerPath = toContainerPath(path);

    // Attach the watcher before the initial scan so files created mid-scan are
    // not missed (D6). Events are buffered until the scan finishes and then
    // replayed; the handlers re-check the DB, so files the scan already added
    // are skipped.
    let buffered: Array<() => Promise<void>> | null = [];
    const dispatch = (fn: () => Promise<void>) => {
      if (buffered) buffered.push(fn);
      else void fn();
    };

    // Setup watcher.
    let watcher: chokidar.FSWatcher | undefined;
    try {
      watcher = chokidar.watch(containerPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100,
        },
        // Same storage folders the scanner skips: if the variants path sits
        // inside a media path, encoder output (.jpg posters, .mp4 opts) must
        // not be imported and re-encoded in a loop.
        ignored: [
          /(^|[\/\\])\../,
          /\.DS_Store$/,
          /Thumbs\.db$/,
          /\.tmp$/,
          /\.log$/,
          (p: string) =>
            p.startsWith(containerPath) &&
            /(^|[\/\\])(uploads|variants|encodes)([\/\\]|$)/.test(p.slice(containerPath.length)),
        ],
      });

      // Setup event listeners
      watcher
        .on('add', (filePath: string) => {
          dispatch(() => this.handleFileAdded(filePath, userId, containerPath));
        })
        .on('change', (filePath: string) => {
          dispatch(() => this.handleFileChanged(filePath, userId, containerPath));
        })
        .on('unlink', (filePath: string) => {
          dispatch(() => this.handleFileDeleted(filePath, userId, containerPath));
        })
        .on('addDir', (dirPath: string) => {
          dispatch(() => this.handleDirectoryAdded(dirPath, userId, containerPath));
        })
        .on('unlinkDir', (dirPath: string) => {
          dispatch(() => this.handleDirectoryDeleted(dirPath, userId, containerPath));
        })
        .on('error', (error) => {
          this.logger.error(`Watcher error for ${path}:`, error);
        });

      // Register now (not after the scan) so the 30s updateWatchers poll does
      // not see this id as missing and start a second scan + watcher.
      this.watchers.set(id, { id, path: containerPath, watcher });
    } catch (error) {
      this.logger.error(`Failed to add watcher for ${path}:`, error as Error);
    }

    // Do an initial scan, but don't crash if a path is missing or unreadable.
    try {
      await scan(containerPath, userId, { skipAlbumFor: containerPath });
    } catch (error: unknown) {
      this.logger.error(`Initial scan failed for ${containerPath} because: ${error}`);
    }

    const queued = buffered;
    buffered = null;
    // Drop the backlog if the path was removed while the scan ran.
    if (!watcher || this.watchers.get(id)?.watcher !== watcher) return;
    for (const fn of queued) {
      await fn();
    }
  }

  // The media drive sits behind a flaky USB bridge. While it remounts, chokidar
  // can report files and folders as unlinked. Only trust a delete when the
  // watched root is still readable and non-empty.
  private async isRootAvailable(rootPath: string): Promise<boolean> {
    try {
      const entries = await readdir(rootPath);
      return entries.length > 0;
    } catch {
      return false;
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
    const usersPaths =
      (await trpc.mediaSourcesSettings.getAll.query()) as RouterOutputs['mediaSourcesSettings']['getAll'];
    const allPaths = usersPaths.flatMap(
      (u: { paths: { id: string; path: string; userId: string }[] }) => u.paths,
    );

    const currentPathIds = new Set(allPaths.map((p: { id: string }) => p.id));
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

  private async handleFileAdded(filePath: string, userId: string, rootPath: string) {
    if (!isSupportedFile(filePath)) {
      return; // Skip unsupported files
    }

    this.logger.info(`File added: ${filePath}`);

    try {
      // Check if file exists and get stats
      if (!existsSync(filePath)) {
        this.logger.warn(`File no longer exists: ${filePath}`);
        return;
      }

      const stats = statSync(filePath);
      const ext = extname(filePath).slice(1).toLowerCase();
      const type = getMediaType(ext);

      if (!type) {
        return; // Skip if not supported media type
      }

      const mime = rawMime(ext) || mimeLookup(ext) || (type === 'image' ? 'image/*' : 'video/*');
      // The DB stores host-style paths (the scanner does the same); the
      // container path is only for reading the file.
      const dir = toHostPath(dirname(filePath));
      const name = basename(filePath);

      // Check if file already exists in database
      const existingFiles = (await trpc.files.getFilesInDir.query(dir)) as Array<{
        id: string;
        name: string;
        dir: string;
      }>;
      const fileExists = existingFiles.some((f) => f.name === name);

      if (!fileExists) {
        // Compute content hash for deduplication
        let contentHash: string | undefined;
        try {
          contentHash = await computeFileHash(filePath);
        } catch (err) {
          this.logger.warn(`Failed to compute hash for ${filePath}: ${err}`);
        }

        // Create the file record
        const fileCreateResult = await trpc.files.create.mutate([
          {
            dir,
            type,
            mime,
            name,
            size: stats.size,
            contentHash,
          },
        ]);

        if (fileCreateResult[0]?.rawCompanion) {
          // A camera RAW next to its JPEG: stored as the JPEG's hidden companion.
          this.logger.info(`Paired RAW file with its JPEG: ${filePath}`);
          return;
        }

        if (fileCreateResult && fileCreateResult.length > 0 && fileCreateResult[0]) {
          const newFileId = fileCreateResult[0].id;

          // Get user's default library
          const libraryId = await trpc.library.getDefaultLibraryIdForUser.query(userId);

          // Link file to library
          await trpc.libraryFile.create.mutate([
            {
              fileId: newFileId,
              libraryId,
            },
          ]);

          // Check if album exists for this directory, create if needed (but never for the root watched path)
          const albumName = basename(dir);
          const [existingAlbum] = await trpc.album.getAlbumByDir.query(dir);

          if (!existingAlbum && albumName && dir !== toHostPath(rootPath)) {
            // Determine parent folder path
            const parentPath = dirname(dir) !== dir ? dirname(dir) : null;

            // Look up parent album ID if it exists
            let parentAlbumId: string | null = null;
            if (parentPath) {
              const [parentAlbum] = await trpc.album.getAlbumByDir.query(parentPath);
              if (parentAlbum && parentAlbum.id) {
                parentAlbumId = parentAlbum.id;
              }
            }

            // Create the new album
            await trpc.album.create.mutate({
              userId: userId,
              album: {
                name: albumName,
                libraryId: libraryId,
                dir: dir,
                parentId: parentAlbumId,
              },
            });

            this.logger.info(`Created new album for directory: ${dir}`);
          }

          // Link file to album if album exists
          const [album] = await trpc.album.getAlbumByDir.query(dir);
          if (album) {
            await trpc.albumFile.create.mutate([
              {
                fileId: newFileId,
                albumId: album.id,
              },
            ]);
            if (!album.parentId) {
              const parentDir = dirname(dir);
              const maybeParent =
                parentDir !== dir ? await trpc.album.getAlbumByDir.query(parentDir) : [];
              if (maybeParent[0]) {
                await trpc.album.setParentByDir.mutate({
                  libraryId,
                  dir,
                  parentId: maybeParent[0].id,
                });
              }
            }
          }

          // Encoding job is automatically queued by the files.create API endpoint
          if (type === 'image' && mime !== 'image/svg+xml') {
            this.logger.info(`Encoding job queued for new image: ${filePath} (ID: ${newFileId})`);
          }

          this.logger.info(`Successfully processed new file: ${filePath}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error processing file addition ${filePath}:`, error as Error);
    }
  }

  private async handleFileChanged(filePath: string, userId: string, rootPath: string) {
    if (!isSupportedFile(filePath)) {
      return; // Skip unsupported files
    }

    this.logger.info(`File changed: ${filePath}`);

    try {
      if (!existsSync(filePath)) {
        this.logger.warn(`Changed file no longer exists: ${filePath}`);
        return;
      }

      const dir = toHostPath(dirname(filePath));
      const name = basename(filePath);

      const existingFiles = (await trpc.files.getFilesInDir.query(dir)) as Array<{
        id: string;
        name: string;
        dir: string;
        size: number;
        contentHash: string | null;
      }>;
      const existing = existingFiles.find((f) => f.name === name);

      // Not tracked yet (e.g. created+modified before the add settled) — treat
      // as a new file.
      if (!existing) {
        await this.handleFileAdded(filePath, userId, rootPath);
        return;
      }

      // Compare content: a pure touch / metadata-only change keeps the same
      // hash and needs no reprocessing.
      let contentHash: string | undefined;
      try {
        contentHash = await computeFileHash(filePath);
      } catch (err) {
        this.logger.warn(`Failed to compute hash for changed file ${filePath}: ${err}`);
        return;
      }
      if (existing.contentHash && existing.contentHash === contentHash) {
        return;
      }

      const stats = statSync(filePath);
      await trpc.files.refreshChangedFile.mutate({
        fileId: existing.id,
        size: stats.size,
        contentHash,
      });
      this.logger.info(`Re-processing changed file: ${filePath}`);
    } catch (error) {
      this.logger.error(`Error processing file change ${filePath}:`, error as Error);
    }
  }

  private async handleFileDeleted(filePath: string, userId: string, rootPath: string) {
    if (!isSupportedFile(filePath)) {
      return; // Skip unsupported files
    }

    this.logger.info(`File deleted: ${filePath}`);

    try {
      if (!(await this.isRootAvailable(rootPath))) {
        this.logger.warn(`Ignoring delete of ${filePath}: media root ${rootPath} is unavailable`);
        return;
      }

      const dir = toHostPath(dirname(filePath));
      const name = basename(filePath);

      // Find and remove the file from database
      const existingFiles = (await trpc.files.getFilesInDir.query(dir)) as Array<{
        id: string;
        name: string;
      }>;
      const fileToDelete = existingFiles.find((f) => f.name === name);

      if (fileToDelete) {
        await trpc.files.removeFilesById.mutate([fileToDelete.id]);

        // Also remove from album files and library files due to foreign key constraints
        await trpc.albumFile.removeAlbumFilesById.mutate([fileToDelete.id]);
        await trpc.libraryFile.removeLibraryFilesById.mutate([fileToDelete.id]);

        this.logger.info(`Successfully removed deleted file from database: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`Error processing file deletion ${filePath}:`, error as Error);
    }
  }

  private async handleDirectoryAdded(dirPath: string, userId: string, rootPath: string) {
    this.logger.info(`Directory added: ${dirPath}`);

    try {
      // Scan the new directory; scanner will also avoid album creation for root
      await scan(dirPath, userId, { skipAlbumFor: rootPath });
      this.logger.info(`Successfully scanned new directory: ${dirPath}`);
    } catch (error) {
      this.logger.error(`Error processing directory addition ${dirPath}:`, error as Error);
    }
  }

  private async handleDirectoryDeleted(dirPath: string, userId: string, rootPath: string) {
    this.logger.info(`Directory deleted: ${dirPath}`);

    try {
      if (!(await this.isRootAvailable(rootPath))) {
        this.logger.warn(`Ignoring delete of ${dirPath}: media root ${rootPath} is unavailable`);
        return;
      }

      const dir = toHostPath(dirPath);

      // Remove all files under this directory (recursively) for the user
      await trpc.files.removeFilesUnderDir.mutate({ dir, userId });

      // Note: Album deletion is not implemented in the API
      // After removing files, try to remove now-empty albums below this path
      try {
        const result = await trpc.album.removeEmptyUnderDir.mutate({ dir, userId });
        this.logger.info(
          `Removed ${result.removed} empty album(s) under deleted directory: ${dirPath}`,
        );
      } catch (innerErr) {
        this.logger.warn(`Failed to remove empty albums under ${dirPath}: ${String(innerErr)}`);
      }

      this.logger.info(`Successfully cleaned up deleted directory: ${dirPath}`);
    } catch (error) {
      this.logger.error(`Error processing directory deletion ${dirPath}:`, error as Error);
    }
  }
}
