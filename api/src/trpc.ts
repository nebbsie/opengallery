import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { auth } from "./auth/auth.js";
import type { Context, PrivateContext } from "./context.js";
import { logger } from "./logger.js";

export const t = initTRPC.context<Context>().create({ transformer: superjson });

// auth middlewares
const attachAuth = t.middleware(async ({ ctx, next }) => {
  const bearerOk =
    ctx.req.headers.authorization === `Bearer ${process.env["WATCHER_TOKEN"]}`;

  const session = bearerOk
    ? null
    : await auth.api.getSession({ headers: toHeaders(ctx.req.headers) });

  const userId = bearerOk
    ? "watcher"
    : ((session?.user?.id as string | undefined) ?? null);

  const expiresAt = (session as any)?.session?.expiresAt as
    | string
    | Date
    | undefined;
  if (expiresAt && new Date(expiresAt) <= new Date()) {
    // let requireUser decide if needed; public can ignore
  }

  return next({
    ctx: { ...ctx, userId, session },
  });
});

const requireUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: ctx as PrivateContext });
});

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    const waitMs = Math.floor(Math.random() * 700) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  logger.info(`[TRPC] ${path} took ${end - start}ms to execute`);

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
  .use(attachAuth); // ctx.userId: string | null

export const privateProcedure = t.procedure
  .use(timingMiddleware)
  .use(attachAuth)
  .use(requireUser); // ctx typed as PrivateContext (userId: string)
