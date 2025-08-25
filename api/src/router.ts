import { router, t } from "./trpc.js";
import { healthRouter } from "./routers/health.router.js";
import { mediaSourcesSettingsRouter } from "./routers/media-sources-settings.router.js";
import { directoryRouter } from "./routers/directory.router.js";
import { filesRouter } from "./routers/files.router.js";
import { libraryFileRouter } from "./routers/library-file.router.js";
import { libraryRouter } from "./routers/library.router.js";
import { eventLogRouter } from "./routers/event-log.router.js";
import { watcherRouter } from "./routers/watcher/watcher.router.js";
import { albumRouter } from "./routers/album.router.js";
import { albumFileRouter } from "./routers/album-file.router.js";

export const appRouter = router({
  health: healthRouter,
  mediaSourcesSettings: mediaSourcesSettingsRouter,
  directory: directoryRouter,
  files: filesRouter,
  library: libraryRouter,
  libraryFile: libraryFileRouter,
  eventLog: eventLogRouter,
  watcher: watcherRouter,
  album: albumRouter,
  albumFile: albumFileRouter,
});

export type AppRouter = typeof appRouter;
