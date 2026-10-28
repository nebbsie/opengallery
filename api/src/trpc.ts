import { initTRPC, TRPCError } from "@trpc/server";
import { createHash, timingSafeEqual } from "node:crypto";
import superjson from "superjson";
import { getCachedSession } from "./auth/session-cache.js";
import { logger } from "./logger.js";
import { getRequestStats } from "./request-context.js";
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

// Constant-time check of a presented token against INTERNAL_TOKEN. Both sides
// are hashed first so the compare does not leak the token length either.
export function isInternalToken(token: string | undefined): boolean {
  const expected = process.env["INTERNAL_TOKEN"];
  if (!expected || token === undefined) return false;
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const AuthMiddleware = t.middleware(async ({ ctx, next }) => {
  const authz = ctx.req.headers.authorization;
  const bearer = authz?.startsWith("Bearer ") ? authz.slice(7) : undefined;
  const isInternal = isInternalToken(bearer);

  let session: any = null;
  let userId: string | null = null;

  if (!isInternal) {
    session = await getCachedSession(toHeaders(ctx.req.headers));
    const expiresAt = session?.session?.expiresAt;
    const expired = !expiresAt || new Date(expiresAt) <= new Date();
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

// Admin-only middleware (real user + admin role)
const AdminMiddleware = t.middleware(({ ctx, next }) => {
  if (ctx.isInternal || !ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (ctx.session?.user?.type !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
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

// Procedures slower than this get logged with how many DB queries they ran and
// how long those took. Query counts are deltas off the shared per-request stats
// scope; under request batching (multiple procedures in one HTTP request) they
// can interleave, so treat the per-procedure counts as approximate.
const SLOW_TRPC_MS = Number(process.env["SLOW_TRPC_MS"] ?? 200);

// Mask secrets before an input goes to the logs (users.create carries a
// plaintext password and is always slow because of the password hash).
function redactInput(input: unknown): string | undefined {
  return JSON.stringify(input, (key, value) =>
    /password|token|secret/i.test(key) ? "[redacted]" : value,
  );
}

const TimingMiddleware = t.middleware(async ({ next, path, input }) => {
  const stats = getRequestStats();
  const startCount = stats?.queryCount ?? 0;
  const startDbMs = stats?.queryMs ?? 0;
  const start = Date.now();

  const result = await next();
  const duration = Date.now() - start;

  if (duration > SLOW_TRPC_MS) {
    logger.warn(`[TRPC] SLOW REQUEST ${path} took ${duration}ms`, {
      queries: (stats?.queryCount ?? 0) - startCount,
      dbMs: Number(((stats?.queryMs ?? 0) - startDbMs).toFixed(1)),
      input: redactInput(input),
    });
  }

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

// Admin-only endpoints (real user with admin role).
export const adminProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware)
  .use(AdminMiddleware);

// Internal-only endpoints.
export const internalProcedure = t.procedure
  .use(TimingMiddleware)
  .use(AuthMiddleware)
  .use(InternalMiddleware);
