import { Logger } from '@opengallery/logger';
import chokidar from 'chokidar';
import { lookup as mimeLookup } from 'mime-types';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { withConcurrency } from '../utils/concurrency.js';
import { trpc, type RouterOutputs } from '../utils/trpc.js';
import { scan } from './scanner.js';

interface WatchedPath {
  id: string;
  path: string;
  watcher: chokidar.FSWatcher;
}

type MediaType = 'image' | 'video';

const imageExt = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']);
const videoExt = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv']);
const allowed = new Set([...imageExt, ...videoExt]);

function getMediaType(ext: string): MediaType | null {
  if (imageExt.has(ext)) return 'image';
  if (videoExt.has(ext)) return 'video';
  return null;
}

function isSupportedFile(filePath: string): boolean {
  const ext = extname(filePath).slice(1).toLowerCase();
  return allowed.has(ext);
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
    const containerRootPrefix = process.env['HOST_ROOT_PREFIX'];
    const toContainerPath = (p: string) =>
      containerRootPrefix && containerRootPrefix.trim() !== ''
        ? p === '/'
          ? containerRootPrefix
          : `${containerRootPrefix}${p}`
        : p;
    const containerPath = toContainerPath(path);

    // Do an initial scan, but don't crash if a path is missing or unreadable.
    try {
      await withConcurrency(() => scan(containerPath, userId, { skipAlbumFor: containerPath }));
    } catch (error: unknown) {
      this.logger.error(`Initial scan failed for ${containerPath} because: ${error}`);
    }

    // Setup watcher.
    try {
      const watcher = chokidar.watch(containerPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100,
        },
        ignored: [/(^|[\/\\])\../, /\.DS_Store$/, /Thumbs\.db$/, /\.tmp$/, /\.log$/],
      });

      // Setup event listeners
      watcher
        .on('add', async (filePath: string) => {
          await withConcurrency(() => this.handleFileAdded(filePath, userId, containerPath));
        })
        .on('change', async (filePath: string) => {
          await withConcurrency(() => this.handleFileChanged(filePath, userId, containerPath));
        })
        .on('unlink', async (filePath: string) => {
          await withConcurrency(() => this.handleFileDeleted(filePath, userId, containerPath));
        })
        .on('addDir', async (dirPath: string) => {
          await withConcurrency(() => this.handleDirectoryAdded(dirPath, userId, containerPath));
        })
        .on('unlinkDir', async (dirPath: string) => {
          await withConcurrency(() => this.handleDirectoryDeleted(dirPath, userId, containerPath));
        })
        .on('error', (error) => {
          this.logger.error(`Watcher error for ${path}:`, error);
        });

      this.watchers.set(id, { id, path: containerPath, watcher });
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

      const mime = mimeLookup(ext) || (type === 'image' ? 'image/*' : 'video/*');
      const dir = dirname(filePath);
      const name = basename(filePath);

      // Check if file already exists in database
      const existingFiles = (await trpc.files.getFilesInDir.mutate(dir)) as Array<{
        id: string;
        name: string;
        dir: string;
      }>;
      const fileExists = existingFiles.some((f) => f.name === name);

      if (!fileExists) {
        // Create the file record
        const fileCreateResult = await trpc.files.create.mutate([
          {
            dir,
            type,
            mime,
            name,
            size: stats.size,
          },
        ]);

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

          if (!existingAlbum && albumName && dir !== rootPath) {
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

          // Check if folder exists for this directory, create if needed (but never for the root watched path)
          const folderName = basename(dir);
          const [existingFolder] = await trpc.folder.getFolderByDir.query(dir);

          if (!existingFolder && folderName && dir !== rootPath) {
            // Determine parent folder path
            const parentPath = dirname(dir) !== dir ? dirname(dir) : null;

            // Look up parent folder ID if it exists
            let parentFolderId: string | null = null;
            if (parentPath) {
              const [parentFolder] = await trpc.album.getAlbumByDir.query(parentPath);
              if (parentFolder && parentFolder.id) {
                parentFolderId = parentFolder.id;
              }
            }

            // Create the new folder
            await trpc.folder.create.mutate({
              userId: userId,
              folder: {
                name: folderName,
                libraryId: libraryId,
                dir: dir,
                parentId: parentFolderId,
              },
            });

            this.logger.info(`Created new folder for directory: ${dir}`);
          }

          // Link file to album if album exists
          const [folder] = await trpc.folder.getFolderByDir.query(dir);
          if (folder) {
            await trpc.folderFile.create.mutate([
              {
                fileId: newFileId,
                folderId: folder.id,
              },
            ]);
            if (!folder.parentId) {
              const parentDir = dirname(dir);
              const maybeParent =
                parentDir !== dir ? await trpc.folder.getFolderByDir.query(parentDir) : [];
              if (maybeParent[0]) {
                await trpc.folder.setParentByDir.mutate({
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
      // For now, treat changes similar to additions
      // In the future, you might want to update file metadata or re-encode
      await this.handleFileAdded(filePath, userId, rootPath);
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
      const dir = dirname(filePath);
      const name = basename(filePath);

      // Find and remove the file from database
      const existingFiles = (await trpc.files.getFilesInDir.mutate(dir)) as Array<{
        id: string;
        name: string;
      }>;
      const fileToDelete = existingFiles.find((f) => f.name === name);

      if (fileToDelete) {
        await trpc.files.removeFilesById.mutate([fileToDelete.id]);

        // Also remove from album files and library files due to foreign key constraints
        await trpc.albumFile.removeAlbumFilesById.mutate([fileToDelete.id]);
        await trpc.libraryFile.removeLibraryFilesById.mutate([fileToDelete.id]);
        await trpc.folderFile.removeFolderFilesById.mutate([fileToDelete.id]);

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
      // Remove all files under this directory (recursively) for the user
      await trpc.files.removeFilesUnderDir.mutate({ dir: dirPath, userId });

      // Note: Album deletion is not implemented in the API
      // After removing files, try to remove now-empty albums below this path
      try {
        const result = await trpc.album.removeEmptyUnderDir.mutate({ dir: dirPath, userId });
        this.logger.info(
          `Removed ${result.removed} empty album(s) under deleted directory: ${dirPath}`,
        );
      } catch (innerErr) {
        this.logger.warn(`Failed to remove empty albums under ${dirPath}: ${String(innerErr)}`);
      }

      // Note: Folder deletion is not implemented in the API
      // The folder will remain but without files, which is acceptable for now
      const [folder] = await trpc.folder.getFolderByDir.query(dirPath);
      if (folder) {
        this.logger.info(`Folder exists for deleted directory: ${dirPath} (not removing folder)`);
      }

      this.logger.info(`Successfully cleaned up deleted directory: ${dirPath}`);
    } catch (error) {
      this.logger.error(`Error processing directory deletion ${dirPath}:`, error as Error);
    }
  }
}
