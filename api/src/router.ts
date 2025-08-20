import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.router.js";
import { mediaLocationsRouter } from "./routers/media-locations.router.js";

export const appRouter = router({
  health: healthRouter,
  mediaLocations: mediaLocationsRouter,
});

export type AppRouter = typeof appRouter;
