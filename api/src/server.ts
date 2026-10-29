import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import * as fs from "node:fs";
import path from "path";
import { auth } from "./auth/auth.js";
import { clearSessionCache } from "./auth/session-cache.js";
import { getEffectiveSession } from "./auth/view-as.js";
import { canUserViewFile } from "./authz/shared-access.js";
import { db } from "./db/index.js";
import {
  FaceTable,
  FileTable,
  FileVariantTable,
  type FileVariantType,
} from "./db/schema.js";
import { logger } from "./logger.js";
import metricsPlugin from "./metrics.js";
import { beginRequestStats, type RequestStats } from "./request-context.js";
import { appRouter, type AppRouter } from "./router.js";
import { createContext, toHeaders } from "./trpc.js";
import { resolveAssetPath } from "./utils/media-path.js";
import { isRawName } from "./utils/raw-pairing.js";
import {
  takeDownloadTicket,
  uniqueZipNames,
  writeZip,
  ZIP_MAX_BYTES,
  ZIP_MAX_ENTRIES,
} from "./utils/zip-download.js";
import { backfillLargeThumbnails } from "./routers/files.router.js";
import { uploadRoutes } from "./uploads/upload-routes.js";
import { startUploadCleanup } from "./uploads/upload-store.js";
import { wsManager } from "./ws-manager.js";

const server: FastifyInstance = Fastify();

const rawOrigins = process.env["TRUSTED_ORIGINS"];
const allowAll = !rawOrigins || rawOrigins.trim() === "*";
const parsedOrigins = rawOrigins
  ? rawOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

// With TRUSTED_ORIGINS unset or "*", any origin used to be reflected with
// credentials, so any other site (for example another service on the same
// host, which counts as same-site for cookies) could read a signed-in user's
// data. In production the web app is served same-origin by nginx and needs no
// CORS, so "*" there allows no cross-origin reads. Dev (web on :4200, api on
// :3000) still reflects.
const isProduction = process.env["NODE_ENV"] === "production";

await server.register(cors, {
  origin: allowAll
    ? (_origin, cb) => cb(null, !isProduction)
    : (origin, cb) => cb(null, !!origin && parsedOrigins.includes(origin)),
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 86400,
});

await server.register(metricsPlugin);

// Slow-request logging. Every request opens a DB-query stats scope; on response
// anything over SLOW_REQUEST_MS is logged with how much of the time was spent
// in SQL (and the single slowest query), so the logs show whether a slow page
// or a slow thumbnail/asset download is query-bound or not. Set to 0 to log all.
const SLOW_REQUEST_MS = Number(process.env["SLOW_REQUEST_MS"] ?? 500);

server.addHook("onRequest", async (req) => {
  (req as { __reqStart?: bigint }).__reqStart = process.hrtime.bigint();
  (req as { __stats?: RequestStats }).__stats = beginRequestStats();
});

server.addHook("onResponse", async (req, reply) => {
  const start = (req as { __reqStart?: bigint }).__reqStart;
  if (start === undefined) return;
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  if (ms < SLOW_REQUEST_MS) return;

  const stats = (req as { __stats?: RequestStats }).__stats;
  logger.warn(
    `[http] SLOW ${req.method} ${req.url} → ${reply.statusCode} ${ms.toFixed(0)}ms`,
    {
      queries: stats?.queryCount ?? 0,
      dbMs: stats ? Number(stats.queryMs.toFixed(1)) : 0,
      slowestQueryMs: stats?.slowest ? Number(stats.slowest.ms.toFixed(1)) : 0,
      slowestQuery: stats?.slowest?.sql,
    },
  );
});

server.get("/health", async () => ({ status: "ok" }));

await server.register(websocket);

server.get("/ws", { websocket: true }, async (socket, req) => {
  const session = await getEffectiveSession(toHeaders(req.headers));
  const userId = session?.user?.id as string | undefined;
  if (!userId) {
    socket.close(4001, "Unauthorized");
    return;
  }
  wsManager.add(socket, userId);
});

server.get("/asset/:id/:variant?", async (req, reply) => {
  const { id, variant } = req.params as { id: string; variant?: string };

  const session = await getEffectiveSession(toHeaders(req.headers));
  const sessionUserId = (session?.user?.id as string | undefined) ?? null;

  if (!sessionUserId) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const canView = await canUserViewFile(sessionUserId, session, id);
  if (!canView) {
    // Same answer as a missing file, so a viewer cannot tell a hidden one exists.
    return reply.code(404).send({ error: "Not found" });
  }

  // Normalize the variant up front so an invalid one is rejected before any query.
  const lower = variant?.toLowerCase();
  const v =
    lower === "thumbnail" ||
    lower === "optimised" ||
    lower === "thumbnail_lg" ||
    lower === "raw" ||
    lower === "motion"
      ? lower
      : variant
        ? "invalid"
        : null;

  if (v === "invalid") {
    return reply
      .code(400)
      .send({ error: "Variant must be thumbnail | thumbnail_lg | optimised | raw | motion" });
  }

  const variantFile = async (type: string) =>
    (
      await db
        .select({ file: FileTable })
        .from(FileVariantTable)
        .innerJoin(FileTable, eq(FileVariantTable.fileId, FileTable.id))
        .where(
          and(
            eq(FileVariantTable.originalFileId, id),
            eq(FileVariantTable.type, type as FileVariantType),
          ),
        )
        .limit(1)
    )[0]?.file;

  // Single query on the hot thumbnail path: fetch either the original row or the
  // variant's file row directly. A variant request doesn't need the base row, so
  // we skip it (previously two queries: base + variant join).
  const originalRow = async () =>
    (await db.select().from(FileTable).where(eq(FileTable.id, id)).limit(1))[0];

  // "raw": the camera RAW of a RAW+JPEG pair (a hidden companion, so only
  // reachable through its photo), or the file itself when it is a RAW.
  const rawFile = async () => {
    const base = await originalRow();
    if (!base) return undefined;
    if (base.rawFileId) {
      return (
        await db.select().from(FileTable).where(eq(FileTable.id, base.rawFileId)).limit(1)
      )[0];
    }
    return isRawName(base.name) ? base : undefined;
  };

  // "motion": the Live Photo video of a still (a hidden companion, so only
  // reachable through its still): its small playable mp4, or the original
  // until that encode exists.
  let motionNotEncoded = false;
  const motionFile = async () => {
    const base = await originalRow();
    if (!base?.motionFileId) return undefined;
    const encoded = (
      await db
        .select({ file: FileTable })
        .from(FileVariantTable)
        .innerJoin(FileTable, eq(FileVariantTable.fileId, FileTable.id))
        .where(
          and(
            eq(FileVariantTable.originalFileId, base.motionFileId),
            eq(FileVariantTable.type, "optimised"),
          ),
        )
        .limit(1)
    )[0]?.file;
    if (encoded) return encoded;
    motionNotEncoded = true;
    return (await db.select().from(FileTable).where(eq(FileTable.id, base.motionFileId)).limit(1))[0];
  };

  let target =
    v == null
      ? await originalRow()
      : v === "raw"
        ? await rawFile()
        : v === "motion"
          ? await motionFile()
          : await variantFile(v);

  // The 640 px grid thumbnail is filled in by a backfill. Until it exists, serve
  // the 320 px one, but only cache it briefly so the sharp one shows up later.
  // The motion original is served until its encode exists: cache it briefly.
  let isFallback = motionNotEncoded;
  if (!target && v === "thumbnail_lg") {
    target = await variantFile("thumbnail");
    isFallback = !!target;
  }

  if (!target) {
    return reply
      .code(404)
      .send({ error: v == null ? "Asset not found" : `Variant not found: ${v}` });
  }

  const abs = await resolveAssetPath(
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
    .header(
      "Cache-Control",
      isFallback ? "private, max-age=600" : "private, max-age=31536000, immutable",
    );

  // ?download=1 on the original (or its RAW) saves it under its own file name.
  if ((v == null || v === "raw") && (req.query as { download?: string }).download === "1") {
    reply.header("Content-Disposition", contentDisposition(target.name));
  }

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2])) {
      return reply
        .code(416)
        .header("Content-Range", `bytes */${target.size}`)
        .send();
    }
    // "bytes=-N" is a suffix range (the last N bytes). An end past the file is
    // clamped to the last byte (RFC 9110), as players often ask for more.
    let start: number;
    let end: number;
    if (!m[1]) {
      start = Math.max(0, target.size - parseInt(m[2]!, 10));
      end = target.size - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] ? Math.min(parseInt(m[2], 10), target.size - 1) : target.size - 1;
    }
    if (start > end || start >= target.size) {
      return reply
        .code(416)
        .header("Content-Range", `bytes */${target.size}`)
        .send();
    }

    reply
      .code(206)
      .header("Accept-Ranges", "bytes")
      .header("Content-Range", `bytes ${start}-${end}/${target.size}`)
      .header("Content-Length", String(end - start + 1));

    return reply.send(fs.createReadStream(abs, { start, end }));
  }

  return reply.send(fs.createReadStream(abs));
});

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Zip download of a selection. The ticket comes from files.createDownload,
// which already checked access; the session must still be the same user.
server.get("/download/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  const session = await getEffectiveSession(toHeaders(req.headers));
  const userId = (session?.user?.id as string | undefined) ?? null;
  if (!userId) return reply.code(401).send({ error: "Unauthorized" });

  const fileIds = takeDownloadTicket(token, userId);
  if (!fileIds) {
    return reply.code(404).send({ error: "Download link expired. Try again." });
  }

  const rows: (typeof FileTable.$inferSelect)[] = [];
  for (let i = 0; i < fileIds.length; i += 500) {
    rows.push(
      ...(await db
        .select()
        .from(FileTable)
        .where(inArray(FileTable.id, fileIds.slice(i, i + 500)))),
    );
  }
  const byId = new Map(rows.map((r) => [r.id, r]));

  const found: { name: string; path: string; size: number; mtime: Date }[] = [];
  let total = 0;
  for (const id of fileIds) {
    const row = byId.get(id);
    if (!row) continue;
    try {
      const abs = await resolveAssetPath(path.resolve(path.join(row.dir, row.name)));
      const st = await fs.promises.stat(abs);
      if (!st.isFile()) continue;
      total += st.size;
      found.push({ name: row.name, path: abs, size: st.size, mtime: st.mtime });
    } catch {
      // Missing on disk (unplugged drive, moved file): leave it out.
    }
  }

  if (found.length === 0) {
    return reply.code(404).send({ error: "None of the files could be read" });
  }
  if (found.length > ZIP_MAX_ENTRIES || total > ZIP_MAX_BYTES) {
    return reply
      .code(413)
      .send({ error: "Too much to zip at once. Select fewer items (under 4 GB)." });
  }

  const names = uniqueZipNames(found.map((f) => f.name));
  const entries = found.map((f, i) => ({ ...f, name: names[i]! }));
  const stamp = new Date().toISOString().slice(0, 10);

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": contentDisposition(`OpenGallery ${stamp} (${entries.length}).zip`),
    "Cache-Control": "no-store",
    // Stream through nginx instead of spooling the whole zip to its temp dir.
    "X-Accel-Buffering": "no",
  });
  try {
    await writeZip(raw, entries);
    raw.end();
  } catch (err) {
    logger.warn(`[download] zip stopped: ${(err as Error).message}`);
    raw.destroy();
  }
});

// Serve a cropped face thumbnail (the avatar for a person cluster). Mirrors the
// /asset handler: authorize against the face's source file, then stream the crop.
server.get("/face/:faceId", async (req, reply) => {
  const { faceId } = req.params as { faceId: string };

  const session = await getEffectiveSession(toHeaders(req.headers));
  const sessionUserId = (session?.user?.id as string | undefined) ?? null;
  if (!sessionUserId) return reply.code(401).send({ error: "Unauthorized" });

  const [face] = await db
    .select()
    .from(FaceTable)
    .where(eq(FaceTable.id, faceId))
    .limit(1);
  if (!face) return reply.code(404).send({ error: "Face not found" });
  if (!face.cropDir || !face.cropName) {
    return reply.code(404).send({ error: "Face crop not available" });
  }

  const canView = await canUserViewFile(sessionUserId, session, face.fileId);
  if (!canView) return reply.code(404).send({ error: "Face not found" });

  const abs = await resolveAssetPath(
    path.resolve(path.join(face.cropDir, face.cropName)),
  );

  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(abs);
  } catch {
    return reply.code(404).send({ error: "Face crop file missing" });
  }

  const updatedAt = new Date(face.updatedAt);
  const etag = `${face.id}-${stats.size}-${Math.floor(updatedAt.getTime() / 1000)}`;
  if (req.headers["if-none-match"] === etag) return reply.code(304).send();

  reply
    .header("Content-Type", "image/avif")
    .header("Content-Length", String(stats.size))
    .header("ETag", etag)
    .header("Last-Modified", updatedAt.toUTCString())
    // Not immutable: a rescan rewrites the crop under the same face id, so
    // browsers must revalidate (cheap, by ETag).
    .header("Cache-Control", "private, max-age=3600, must-revalidate");

  return reply.send(fs.createReadStream(abs));
});

// Resumable upload chunks (PUT /upload/:id). Its own scope, so its raw body
// parser does not change any other route.
await server.register(uploadRoutes);

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

    // A POST can end or revoke a session (sign-out, revoke-session,
    // change-password). Drop cached sessions so the old cookie stops working
    // now instead of after the session cache TTL.
    if (request.method !== "GET" && request.method !== "HEAD") {
      clearSessionCache();
    }

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
        code === "CONFLICT" ||
        code === "PAYLOAD_TOO_LARGE" ||
        code === "UNSUPPORTED_MEDIA_TYPE" ||
        code === "PRECONDITION_FAILED" ||
        code === "TOO_MANY_REQUESTS";

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
      `CORS mode: ${allowAll ? (isProduction ? "SAME-ORIGIN ONLY (TRUSTED_ORIGINS=* in production)" : "ALLOW ALL (reflect)") : `ALLOWLIST ${JSON.stringify(parsedOrigins)}`}`,
    );

    await server.listen({ port, host });
    startUploadCleanup();

    // Queue the 640 px grid thumbnail for older images (idempotent, cheap when
    // there is nothing to do). Delayed so it never slows the first requests.
    setTimeout(() => {
      backfillLargeThumbnails()
        .then((n) => {
          if (n > 0) logger.info(`[thumbs] queued ${n} large thumbnails`);
        })
        .catch((e) => logger.warn("[thumbs] backfill failed", e as Error));
    }, 15_000);
  } catch (err) {
    logger.error("Failed to start server:", err as Error);
    process.exit(1);
  }
};

start();
