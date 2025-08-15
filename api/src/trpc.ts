import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";
import { auth } from "./auth/auth.js";

export const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const isAuthenticated = (required: boolean) =>
  t.middleware(async (req) => {
    const res = await auth.api.getSession({
      headers: toHeaders(req.ctx.req.headers),
    });

    console.log("Checking authentication for", res);

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

export function toHeaders(h: import("http").IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (Array.isArray(v)) v.forEach((val) => headers.append(k, val));
    else if (v !== undefined) headers.set(k, String(v));
  }
  return headers;
}

export const router = t.router;

export const publicProcedure = t.procedure
  .use(timingMiddleware)
  .use(isAuthenticated(false));

export const privateProcedure = t.procedure
  .use(timingMiddleware)
  .use(isAuthenticated(true));
