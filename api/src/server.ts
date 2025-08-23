import cors from "@fastify/cors";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import { auth } from "./auth/auth.js";
import { createContext } from "./context.js";
import { appRouter, type AppRouter } from "./router.js";
import { logger } from "./logger.js";

const server: FastifyInstance = Fastify();

const rawOrigins = process.env["TRUSTED_ORIGINS"];
const allowAll = !rawOrigins || rawOrigins.trim() === "*";
const parsedOrigins = rawOrigins
  ? rawOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

await server.register(cors, {
  origin: allowAll
    ? (_origin, cb) => cb(null, true)
    : (origin, cb) => cb(null, !!origin && parsedOrigins.includes(origin)),
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 86400,
});

server.get("/health", async () => ({ status: "ok" }));

server.route({
  method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  url: "/api/auth/*",
  handler: async function (request, reply) {
    try {
      // Preflight is handled by @fastify/cors already, but this keeps route unified.
      if (request.method === "OPTIONS") {
        return reply.status(204).send();
      }

      const url = new URL(request.url, `http://${request.headers.host}`);

      // Build Headers for fetch request
      const headers = new Headers();
      Object.entries(request.headers).forEach(([key, value]) => {
        if (value !== undefined) headers.append(key, String(value));
      });

      // Build fetch-compatible Request
      // Using global WHATWG fetch types at runtime. Types may require // @ts-ignore
      // if your tsconfig lacks "DOM".
      // @ts-ignore
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        body:
          request.body && typeof request.body !== "string"
            ? JSON.stringify(request.body)
            : (request.body as any),
      });

      // Delegate to your auth handler
      const response = await auth.handler(req);

      // Apply status
      reply.status(response.status);

      // Strip any upstream CORS headers to avoid conflicts with @fastify/cors
      const strip = new Set([
        "access-control-allow-origin",
        "access-control-allow-credentials",
        "access-control-allow-headers",
        "access-control-allow-methods",
        "access-control-expose-headers",
        "access-control-max-age",
        "vary",
      ]);

      // Forward only non-CORS headers, including Set-Cookie
      response.headers.forEach((value, key) => {
        if (!strip.has(key.toLowerCase())) {
          // Fastify will collect multiple Set-Cookie headers into an array
          reply.header(key, value);
        }
      });

      // Forward body
      const text = await response.text();
      reply.send(text || null);
    } catch (error) {
      logger.error("Authentication Error:", error as Error);
      reply.status(500).send({
        error: "Internal authentication error",
        code: "AUTH_FAILURE",
      });
    }
  },
});

// tRPC
server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
    onError({ path, error }) {
      logger.error(`Error in tRPC handler on path '${path}':`, error);
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
});

const start = async () => {
  try {
    const port = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : 3000;
    const host = process.env["HOST"] ?? "0.0.0.0";
    logger.info(`Starting server on ${host}:${port} ...`);
    logger.info(
      `CORS mode: ${allowAll ? "ALLOW ALL (reflect)" : `ALLOWLIST ${JSON.stringify(parsedOrigins)}`}`,
    );

    await server.listen({ port, host });
  } catch (err) {
    logger.error("Failed to start server:", err as Error);
    process.exit(1);
  }
};

start();
