import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { auth } from "./auth/auth.js";
import { logger } from "./logger.js";
import type { FastifyReply, FastifyRequest } from "fastify";

export type Context = {
  req: FastifyRequest;
  res: FastifyReply;
  userId: string | null;
  isInternal: boolean;
  session: any | null;
};

export type PrivateContext = Context & { userId: string; isInternal: false };
export type InternalContext = Context & { userId: null; isInternal: true };

export async function createContext({
  req,
  res,
}: {
  req: FastifyRequest;
  res: FastifyReply;
}): Promise<Context> {
  return { req, res, userId: null, isInternal: false, session: null };
}

export const t = initTRPC.context<Context>().create({ transformer: superjson });

export function toHeaders(h: import("http").IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (Array.isArray(v)) v.forEach((val) => headers.append(k, val));
    else if (v !== undefined) headers.set(k, String(v));
  }
  return headers;
}

const AuthMiddleware = t.middleware(async ({ ctx, next }) => {
  const authz = ctx.req.headers.authorization;
  const bearer = authz?.startsWith("Bearer ") ? authz.slice(7) : undefined;
  const isInternal =
    Boolean(process.env["INTERNAL_TOKEN"]) &&
    bearer === process.env["INTERNAL_TOKEN"];

  let session: any = null;
  let userId: string | null = null;

  if (!isInternal) {
    session = await auth.api.getSession({
      headers: toHeaders(ctx.req.headers),
    });
    const expiresAt = session?.session?.expiresAt;
    const expired = expiresAt && new Date(expiresAt) <= new Date();
    if (!expired) {
      userId = (session?.user?.id as string | undefined) ?? null;
    }
  }

  return next({ ctx: { ...ctx, isInternal, userId, session } });
});

const PrivateOrInternalMiddleware = t.middleware(({ ctx, next }) => {
  if (ctx.isInternal) {
    return next({
      ctx: { ...ctx, isInternal: true, userId: null } as InternalContext,
    });
  }
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { ...ctx, isInternal: false, userId: ctx.userId } as PrivateContext,
  });
});

// Strict external-only middleware (must be a real user)
const AuthenticatedMiddleware = t.middleware(({ ctx, next }) => {
  if (ctx.isInternal || !ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: ctx as PrivateContext });
});

// Internal-only middleware
const InternalMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.isInternal) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: ctx as InternalContext });
});

// Timing with dev slowdown
const TimingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev && false) {
    const waitMs = Math.floor(Math.random() * 700) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();
  const end = Date.now();
  logger.debug(`[TRPC] ${path} took ${end - start}ms`);
  return result;
});

// Exports
export const router = t.router;

export const publicProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware);

// Use when an internal OR authenticated user is allowed.
// Handlers receive ctx as PrivateContext | InternalContext.
export const privateProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware)
  .use(PrivateOrInternalMiddleware);

// Use when a real user is required (no internal).
export const strictPrivateProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware)
  .use(AuthenticatedMiddleware);

// Internal-only endpoints.
export const internalProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware)
  .use(InternalMiddleware);
