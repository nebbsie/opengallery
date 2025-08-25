import cors from "@fastify/cors";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import { auth } from "./auth/auth.js";
import { createContext } from "./trpc.js";
import { db } from "./db/index.js";
import { FileTable } from "./db/schema.js";
import { logger } from "./logger.js";
import { appRouter, type AppRouter } from "./router.js";
import { eq } from "drizzle-orm";
import path from "path";
import * as fs from "node:fs";
import metricsPlugin from "./metrics.js";

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

await server.register(metricsPlugin);

server.get("/health", async () => ({ status: "ok" }));

server.get("/asset/:id", async (req, reply) => {
  const { id } = req.params as { id: string };

  const [asset] = await db
    .select()
    .from(FileTable)
    .where(eq(FileTable.id, id))
    .limit(1);

  if (!asset) {
    return reply.code(404).send({ error: "Asset not found" });
  }

  const abs = path.resolve(asset.path);
  console.log("Serving asset:", abs);

  const etag = `${asset.size}-${asset.createdAt.getTime() | 0}`;
  if (req.headers["if-none-match"] === etag) {
    return reply.code(304).send();
  }

  // Basic headers
  reply
    .header("Content-Type", asset.mime || "application/octet-stream")
    .header("Content-Length", String(asset.size))
    .header("ETag", etag)
    .header("Last-Modified", asset.updatedAt.toUTCString())
    .header("Cache-Control", "public, max-age=31536000, immutable");

  // Range support (important for video)
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return reply.code(416).send();
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : asset.size - 1;
    if (start > end || end >= asset.size) return reply.code(416).send();

    reply
      .code(206)
      .header("Accept-Ranges", "bytes")
      .header("Content-Range", `bytes ${start}-${end}/${asset.size}`)
      .header("Content-Length", String(end - start + 1));

    return reply.send(fs.createReadStream(abs, { start, end }));
  }

  return reply.send(fs.createReadStream(abs));
});

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
