import { router, t } from "./trpc.js";
import { healthRouter } from "./routers/health.router.js";
import { mediaSourcesSettingsRouter } from "./routers/media-sources-settings.router.js";
import { directoryRouter } from "./routers/directory.router.js";

export const appRouter = router({
  health: healthRouter,
  mediaSourcesSettings: mediaSourcesSettingsRouter,
  directory: directoryRouter,
});

export type AppRouter = typeof appRouter;
