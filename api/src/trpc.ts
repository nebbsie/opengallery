import { initTRPC } from "@trpc/server";
import superjson from "superjson";

export const t = initTRPC.create({
  transformer: superjson,
});

const isAuthenticated = (required: boolean) =>
  t.middleware(async (req) => {
    return req.next();
  });

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 700) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

export const router = t.router;

export const publicProcedure = t.procedure
  .use(timingMiddleware)
  .use(isAuthenticated(false));

export const privateProcedure = t.procedure
  .use(timingMiddleware)
  .use(isAuthenticated(true));
