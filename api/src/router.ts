import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.router.js";

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
