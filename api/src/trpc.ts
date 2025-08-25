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
  return { req, res, userId: null, isInternal: false };
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

// Auth + identity
const AuthMiddleware = t.middleware(async ({ ctx, next }) => {
  const authz = ctx.req.headers.authorization;
  const bearer = authz?.startsWith("Bearer ") ? authz.slice(7) : undefined;
  const isInternal =
    Boolean(process.env["INTERNAL_CODE"]) &&
    bearer === process.env["INTERNAL_CODE"];

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

const AuthenticatedMiddleware = t.middleware(async ({ ctx, next }) => {
  if (ctx.isInternal || !ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: ctx as PrivateContext });
});

const InternalMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.isInternal) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: ctx as InternalContext });
});

// Timing with dev slowdown
const TimingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    const waitMs = Math.floor(Math.random() * 700) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();
  const end = Date.now();
  logger.info(`[TRPC] ${path} took ${end - start}ms`);
  return result;
});

// Exports
export const router = t.router;

export const publicProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware);

export const privateProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware)
  .use(AuthenticatedMiddleware);

export const internalProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware)
  .use(InternalMiddleware);
