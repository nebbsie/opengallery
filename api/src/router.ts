import { albumFileRouter } from "./routers/album-file.router.js";
import { albumRouter } from "./routers/album.router.js";
import { directoryRouter } from "./routers/directory.router.js";
import { eventLogRouter } from "./routers/event-log.router.js";
import { fileTaskRouter } from "./routers/file-task.router.js";
import { filesRouter } from "./routers/files.router.js";
import { geoLocationRouter } from "./routers/geo-location.router.js";
import { healthRouter } from "./routers/health.router.js";
import { imageMetadataRouter } from "./routers/image-metadata.router.js";
import { issuesRouter } from "./routers/issues.router.js";
import { libraryFileRouter } from "./routers/library-file.router.js";
import { libraryRouter } from "./routers/library.router.js";
import { logRouter } from "./routers/log.router.js";
import { mediaSourcesSettingsRouter } from "./routers/media-sources-settings.router.js";
import { queueRouter } from "./routers/queue.router.js";
import { settingsRouter } from "./routers/settings.router.js";
import { uiSettingsRouter } from "./routers/ui-settings.router.js";
import { usersRouter } from "./routers/users.router.js";
import { router } from "./trpc.js";

export const appRouter = router({
  health: healthRouter,
  mediaSourcesSettings: mediaSourcesSettingsRouter,
  directory: directoryRouter,
  files: filesRouter,
  fileTask: fileTaskRouter,
  log: logRouter,
  library: libraryRouter,
  libraryFile: libraryFileRouter,
  eventLog: eventLogRouter,
  album: albumRouter,
  albumFile: albumFileRouter,
  settings: settingsRouter,
  imageMetadata: imageMetadataRouter,
  geoLocation: geoLocationRouter,
  users: usersRouter,
  uiSettings: uiSettingsRouter,
  queue: queueRouter,
  issues: issuesRouter,
});

export type AppRouter = typeof appRouter;
