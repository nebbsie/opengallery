import type { FastifyInstance, FastifyReply } from "fastify";
import type { Readable } from "node:stream";
import { getEffectiveSession } from "../auth/view-as.js";
import { logger } from "../logger.js";
import { toHeaders } from "../trpc.js";
import { MAX_CHUNK_BYTES, UploadError, writeChunk } from "./upload-store.js";

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof UploadError) {
    return reply.code(e.status).send({
      error: e.message,
      code: e.code,
      ...(e.received !== undefined ? { received: e.received } : {}),
    });
  }
  logger.error("[upload] chunk failed", e as Error);
  return reply.code(500).send({ error: "Upload failed", code: "INTERNAL" });
}

// Chunk route for resumable uploads. Sessions are created, finished and
// cancelled over tRPC (upload.*); the bytes come here as a raw body:
//
//   PUT /upload/:id?offset=N   body = bytes N.. of the file
//   -> 200 { received, size }   or 409 { code: "BAD_OFFSET", received }
//
// The body is streamed straight to the part file, never held in memory.
// Registered without fastify-plugin, so the pass-through body parser below only
// applies to this route.
export async function uploadRoutes(app: FastifyInstance) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

  app.put("/upload/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const offset = Number((req.query as { offset?: string }).offset);

    const session = await getEffectiveSession(toHeaders(req.headers));
    const userId = (session?.user?.id as string | undefined) ?? null;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    if ((session as { viewAs?: unknown }).viewAs) {
      return reply
        .code(403)
        .send({ error: "Read-only while viewing as another user", code: "VIEW_AS" });
    }

    const length = Number(req.headers["content-length"] ?? NaN);
    if (Number.isFinite(length) && length > MAX_CHUNK_BYTES) {
      return reply.code(413).send({ error: "Chunk too large", code: "CHUNK_TOO_LARGE" });
    }

    try {
      const body = (req.body as Readable | undefined) ?? req.raw;
      const result = await writeChunk({ id, userId, offset, body });
      return reply.send(result);
    } catch (e) {
      return sendError(reply, e);
    }
  });
}
