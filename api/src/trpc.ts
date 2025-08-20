import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";
import { auth } from "./auth/auth.js";

export const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const isAuthenticated = (required: boolean) =>
  t.middleware(async (req) => {
    if (!required) {
      return req.next();
    }

    const session = await auth.api.getSession({
      headers: toHeaders(req.ctx.req.headers),
    });

    if (required && !session?.user?.id) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    if (
      session?.session?.expiresAt &&
      new Date(session?.session?.expiresAt) <= new Date()
    ) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired" });
    }

    return req.next();
  });

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
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
