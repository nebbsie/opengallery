import { and, eq, exists, inArray, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { addToClipIndex } from "../clip/clip-index.js";
import { db } from "../db/index.js";
import {
  FileEmbeddingTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
  LibraryFileTable,
} from "../db/schema.js";
import { internalProcedure, router } from "../trpc.js";
import { getCachedSystemSettings } from "../utils/settings-cache.js";
import { staleRequeueSet } from "./file-task.router.js";
import { isMotionCompanion, isRawCompanion, notRawCompanion } from "../utils/raw-pairing.js";
import { taskQueued } from "../utils/task-queue.js";

// Worker side of object search: seed and lease `embed_clip` tasks, and store
// each photo's image-text embedding.
export const clipRouter = router({
  // Seed a task for every original photo and video that has none, and revive
  // dead ones. Idempotent; the worker runs it on boot.
  backfillTasks: internalProcedure.mutation(async () => {
    const originals = await db
      .select({ id: FileTable.id })
      .from(FileTable)
      .where(
        and(
          inArray(FileTable.type, ["image", "video"]),
          notExists(
            db.select().from(FileVariantTable).where(eq(FileVariantTable.fileId, FileTable.id)),
          ),
          exists(
            db
              .select()
              .from(LibraryFileTable)
              .where(eq(LibraryFileTable.fileId, FileTable.id)),
          ),
          notRawCompanion(FileTable.id),
          // Only files with no embed_clip task yet. Without this, every boot
          // re-inserted (and conflicted on) a task for every original.
          notExists(
            db
              .select({ one: sql`1` })
              .from(FileTaskTable)
              .where(
                and(
                  eq(FileTaskTable.fileId, FileTable.id),
                  eq(FileTaskTable.type, "embed_clip"),
                ),
              ),
          ),
        ),
      );
    let seeded = 0;
    db.transaction(() => {
      for (let i = 0; i < originals.length; i += 500) {
        seeded += db
          .insert(FileTaskTable)
          .values(originals.slice(i, i + 500).map((f) => ({ fileId: f.id, type: "embed_clip" as const })))
          .onConflictDoNothing()
          .returning({ id: FileTaskTable.id })
          .all().length;
      }
    });
    const now = new Date().toISOString();
    const revived = await db
      .update(FileTaskTable)
      .set({ status: "pending", attempts: 0, startedAt: null, lastError: null, updatedAt: now })
      .where(
        and(
          eq(FileTaskTable.type, "embed_clip"),
          eq(FileTaskTable.status, "failed"),
          sql`${FileTaskTable.attempts} >= 3`,
        ),
      )
      .returning({ id: FileTaskTable.id });
    return { seeded, revived: revived.length };
  }),

  // Lease a batch of embed_clip tasks. Its own loop and concurrency, like
  // face detection, so it never starves encoding.
  leaseFiles: internalProcedure.mutation(async () => {
    const s = await getCachedSystemSettings();
    const desired = Math.max(1, Math.min(16, s?.faceConcurrency ?? 2));
    const now = new Date().toISOString();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await db
      .update(FileTaskTable)
      .set(staleRequeueSet(now))
      .where(
        and(
          eq(FileTaskTable.type, "embed_clip"),
          eq(FileTaskTable.status, "in_progress"),
          sql`${FileTaskTable.startedAt} IS NOT NULL`,
          sql`${FileTaskTable.startedAt} < ${fiveMinutesAgo}`,
        ),
      );
    const candidates = await db
      .select({ fileId: FileTaskTable.fileId })
      .from(FileTaskTable)
      .where(
        and(eq(FileTaskTable.type, "embed_clip"), taskQueued),
      )
      .orderBy(sql`${FileTaskTable.updatedAt} ASC`)
      .limit(desired * 4);
    if (candidates.length === 0) return [];
    const ids = candidates.map((c) => c.fileId);
    await db
      .update(FileTaskTable)
      .set({ status: "in_progress", startedAt: now, updatedAt: now })
      .where(
        and(
          eq(FileTaskTable.type, "embed_clip"),
          inArray(FileTaskTable.fileId, ids),
          inArray(FileTaskTable.status, ["pending", "failed"]),
          sql`${FileTaskTable.attempts} < 3`,
        ),
      );
    return ids;
  }),

  // Store one file's embedding (replaces any older one).
  setEmbedding: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        model: z.string().min(1).max(128),
        // base64 little-endian float32[], unit length
        embedding: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      // A RAW or Live Photo motion companion is never searched on its own.
      if (isRawCompanion(input.fileId) || isMotionCompanion(input.fileId)) return { ok: true as const };
      const vec = Buffer.from(input.embedding, "base64");
      const now = new Date().toISOString();
      await db
        .insert(FileEmbeddingTable)
        .values({ fileId: input.fileId, model: input.model, vec })
        .onConflictDoUpdate({
          target: FileEmbeddingTable.fileId,
          set: { model: input.model, vec, updatedAt: now },
        });
      addToClipIndex(input.fileId, input.model, input.embedding);
      return { ok: true as const };
    }),
});
