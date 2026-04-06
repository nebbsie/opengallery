import cors from "@fastify/cors";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import * as fs from "node:fs";
import path from "path";
import { auth } from "./auth/auth.js";
import { canUserViewFile } from "./authz/shared-access.js";
import { db } from "./db/index.js";
import { FileTable, FileVariantTable } from "./db/schema.js";
import { logger } from "./logger.js";
import metricsPlugin from "./metrics.js";
import { appRouter, type AppRouter } from "./router.js";
import { createContext, toHeaders } from "./trpc.js";

const server: FastifyInstance = Fastify();

type MediaPathMap = { from: string; to: string };

function parseMediaPathMap(raw?: string): MediaPathMap[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [from, to] = entry.split("=");
      if (!from || !to) return null;
      return { from: path.resolve(from), to: path.resolve(to) };
    })
    .filter((m): m is MediaPathMap => m !== null);
}

const mediaPathMap = parseMediaPathMap(process.env["MEDIA_PATH_MAP"]);

function resolveAssetPath(absPath: string): string {
  const resolved = path.resolve(absPath);
  if (fs.existsSync(resolved)) return resolved;

  for (const map of mediaPathMap) {
    if (
      resolved === map.from ||
      resolved.startsWith(`${map.from}${path.sep}`)
    ) {
      const rel = path.relative(map.from, resolved);
      const candidate = path.resolve(map.to, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return resolved;
}

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

server.get("/asset/:id/:variant?", async (req, reply) => {
  const { id, variant } = req.params as { id: string; variant?: string };

  const session = await auth.api.getSession({
    headers: toHeaders(req.headers),
  });
  const sessionUserId = (session?.user?.id as string | undefined) ?? null;

  if (!sessionUserId) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const canView = await canUserViewFile(sessionUserId, session, id);
  if (!canView) {
    return reply.code(403).send({ error: "Forbidden" });
  }

  const [base] = await db
    .select()
    .from(FileTable)
    .where(eq(FileTable.id, id))
    .limit(1);
  if (!base) return reply.code(404).send({ error: "Asset not found" });

  // normalize variant
  const v =
    variant?.toLowerCase() === "thumbnail"
      ? "thumbnail"
      : variant?.toLowerCase() === "optimised" ||
          variant?.toLowerCase() === "optimised"
        ? "optimised"
        : variant
          ? "invalid"
          : null;

  if (v === "invalid") {
    return reply
      .code(400)
      .send({ error: "Variant must be thumbnail | optimised" });
  }

  // pick target file row: original or its variant
  const target =
    v == null
      ? base
      : (
          await db
            .select({ file: FileTable })
            .from(FileVariantTable)
            .innerJoin(FileTable, eq(FileVariantTable.fileId, FileTable.id))
            .where(
              and(
                eq(FileVariantTable.originalFileId, base.id),
                eq(FileVariantTable.type, v),
              ),
            )
            .limit(1)
        )[0]?.file;

  if (!target) {
    logger.error(`Variant ${v} not found for file: ${id}`);
    return reply.code(404).send({ error: `Variant not found: ${v}` });
  }

  const abs = resolveAssetPath(
    path.resolve(path.join(target.dir, target.name)),
  );
  const updatedAt = new Date(target.updatedAt);
  const etag = `${target.id}-${target.size}-${Math.floor(updatedAt.getTime() / 1000)}`;

  if (req.headers["if-none-match"] === etag) return reply.code(304).send();

  reply
    .header("Content-Type", target.mime || "application/octet-stream")
    .header("Content-Length", String(target.size))
    .header("ETag", etag)
    .header("Last-Modified", updatedAt.toUTCString())
    .header("Cache-Control", "public, max-age=31536000, immutable");

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return reply.code(416).send();
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : target.size - 1;
    if (start > end || end >= target.size) return reply.code(416).send();

    reply
      .code(206)
      .header("Accept-Ranges", "bytes")
      .header("Content-Range", `bytes ${start}-${end}/${target.size}`)
      .header("Content-Length", String(end - start + 1));

    return reply.send(fs.createReadStream(abs, { start, end }));
  }

  return reply.send(fs.createReadStream(abs));
});

// Auth handler shared by both routes
const authHandler = async function (
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
) {
  try {
    // Preflight is handled by @fastify/cors already, but this keeps route unified.
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }

    // Normalize URL to /api/auth/* format that better-auth expects
    // - Dev mode: request.url is /api/auth/... (use as-is)
    // - Nginx mode: request.url is /auth/... (add /api prefix)
    const urlPath = request.url.startsWith("/api/auth")
      ? request.url
      : `/api${request.url}`;
    const url = new URL(urlPath, `http://${request.headers.host}`);

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
};

// Route for nginx mode (strips /api prefix)
server.route({
  method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  url: "/auth/*",
  handler: authHandler,
});

// Route for dev mode (direct API access with /api prefix)
server.route({
  method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  url: "/api/auth/*",
  handler: authHandler,
});

// tRPC
server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
    onError({ path, error }) {
      const code = (error as any)?.code as string | undefined;
      const msg = error?.message || "Unknown tRPC error";
      const isExpected =
        code === "UNAUTHORIZED" ||
        code === "FORBIDDEN" ||
        code === "NOT_FOUND" ||
        code === "BAD_REQUEST" ||
        code === "CONFLICT";

      if (isExpected) {
        // concise single line for expected errors
        logger.warn(`[tRPC] ${code ?? "ERROR"} ${path}: ${msg}`);
      } else {
        // include stack only for unexpected errors
        logger.error(`[tRPC] ${code ?? "INTERNAL"} ${path}: ${msg}`, {
          stack: error?.stack,
        });
      }
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
});

const start = async () => {
  try {
    const port = process.env["PORT"] ? parseInt(process.env["PORT"], 10) : 3000;
    const host = process.env["HOST"] ?? "0.0.0.0";
    logger.info(`Starting server on ${host}:${port}...`);
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
