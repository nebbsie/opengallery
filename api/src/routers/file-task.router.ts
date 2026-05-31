import { and, eq, inArray, sql } from "drizzle-orm";
import * as fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTable, FileTaskTable, FileVariantTable } from "../db/schema.js";
import { getCachedSystemSettings } from "../utils/settings-cache.js";
import { resolveAssetPath } from "../utils/media-path.js";
import {
  adminProcedure,
  internalProcedure,
  privateProcedure,
  router,
} from "../trpc.js";
import { wsManager } from "../ws-manager.js";

export const fileTaskRouter = router({
  getCountsByType: internalProcedure.query(async () => {
    const rows = await db
      .select({
        type: FileTaskTable.type,
        status: FileTaskTable.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(FileTaskTable)
      .groupBy(FileTaskTable.type, FileTaskTable.status);
    return rows.map((r) => ({
      type: r.type,
      status: r.status,
      count: Number(r.count),
    }));
  }),

  // Per-task-type rollup for the Tasks settings page: how many of each task type
  // are done vs still outstanding, instead of a per-file list.
  summary: privateProcedure.query(async () => {
    // Counts of every (type, status) pair.
    const byStatus = await db
      .select({
        type: FileTaskTable.type,
        status: FileTaskTable.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(FileTaskTable)
      .groupBy(FileTaskTable.type, FileTaskTable.status);

    // "Remaining" = work the worker will actually still pick up: not succeeded,
    // and under the 3-attempt retry cap (failed-with-attempts>=3 is dead, not
    // outstanding).
    const remainingRows = await db
      .select({
        type: FileTaskTable.type,
        count: sql<number>`COUNT(*)`,
      })
      .from(FileTaskTable)
      .where(
        and(
          inArray(FileTaskTable.status, ["pending", "in_progress", "failed"]),
          sql`${FileTaskTable.attempts} < 3`,
        ),
      )
      .groupBy(FileTaskTable.type);

    const remainingByType = new Map<string, number>();
    for (const r of remainingRows) remainingByType.set(r.type, Number(r.count));

    type Row = {
      type: string;
      total: number;
      pending: number;
      inProgress: number;
      succeeded: number;
      failed: number;
      skipped: number;
      remaining: number;
    };
    const byType = new Map<string, Row>();
    const empty = (type: string): Row => ({
      type,
      total: 0,
      pending: 0,
      inProgress: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      remaining: remainingByType.get(type) ?? 0,
    });

    for (const r of byStatus) {
      const row = byType.get(r.type) ?? empty(r.type);
      const c = Number(r.count);
      row.total += c;
      if (r.status === "pending") row.pending += c;
      else if (r.status === "in_progress") row.inProgress += c;
      else if (r.status === "succeeded") row.succeeded += c;
      else if (r.status === "failed") row.failed += c;
      else if (r.status === "skipped") row.skipped += c;
      byType.set(r.type, row);
    }

    const types = [...byType.values()].sort((a, b) =>
      a.type.localeCompare(b.type),
    );
    const totals = types.reduce(
      (acc, t) => ({
        total: acc.total + t.total,
        succeeded: acc.succeeded + t.succeeded,
        remaining: acc.remaining + t.remaining,
      }),
      { total: 0, succeeded: 0, remaining: 0 },
    );

    return { types, totals };
  }),

  setStatus: internalProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1),
        status: z.enum([
          "pending",
          "in_progress",
          "succeeded",
          "failed",
          "skipped",
        ]),
        error: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const now = new Date().toISOString();
      const update: {
        status: typeof input.status;
        updatedAt: string;
        startedAt?: string;
        finishedAt?: string;
        lastError?: string;
      } = { status: input.status, updatedAt: now };
      if (input.status === "in_progress") update.startedAt = now;
      if (
        input.status === "succeeded" ||
        input.status === "failed" ||
        input.status === "skipped"
      )
        update.finishedAt = now;
      if (input.error) update.lastError = input.error;
      return db
        .update(FileTaskTable)
        .set(update)
        .where(inArray(FileTaskTable.id, input.ids))
        .returning({ id: FileTaskTable.id, status: FileTaskTable.status });
    }),

  createForFile: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        type: z.enum([
          "encode_thumbnail",
          "encode_optimised",
          "video_poster",
          "detect_faces",
          "extract_geolocation",
        ]),
        version: z.number().int().positive().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const [row] = await db
        .insert(FileTaskTable)
        .values({
          fileId: input.fileId,
          type: input.type,
          version: input.version,
        })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    }),

  setStatusByFileAndType: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        type: z.enum([
          "encode_thumbnail",
          "encode_optimised",
          "video_poster",
          "detect_faces",
          "extract_geolocation",
        ]),
        status: z.enum([
          "pending",
          "in_progress",
          "succeeded",
          "failed",
          "skipped",
        ]),
        error: z.string().optional(),
        incrementAttempts: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const now = new Date().toISOString();
      const update: {
        status: typeof input.status;
        updatedAt: string;
        startedAt?: string;
        finishedAt?: string;
        lastError?: string;
        attempts?: ReturnType<typeof sql>;
        progress?: number | null;
      } = { status: input.status, updatedAt: now };
      if (input.status === "in_progress") {
        update.startedAt = now;
        update.progress = 0; // Reset progress when starting
      }
      if (
        input.status === "succeeded" ||
        input.status === "failed" ||
        input.status === "skipped"
      ) {
        update.finishedAt = now;
        update.progress = null; // Clear progress when done
      }
      if (input.error) update.lastError = input.error;
      if (input.incrementAttempts)
        update.attempts = sql`${FileTaskTable.attempts} + 1`;

      const [row] = await db
        .update(FileTaskTable)
        .set(update)
        .where(
          and(
            eq(FileTaskTable.fileId, input.fileId),
            eq(FileTaskTable.type, input.type)
          )
        )
        .returning({ id: FileTaskTable.id, status: FileTaskTable.status });

      if (row && input.status === "succeeded") {
        wsManager.broadcast("file:task-completed", {
          fileId: input.fileId,
          type: input.type,
          status: "succeeded",
        });
      }

      return row ?? null;
    }),

  setManyStatusByFileAndType: internalProcedure
    .input(
      z.array(
        z.object({
          fileId: z.string().uuid(),
          type: z.enum([
            "encode_thumbnail",
            "encode_optimised",
            "video_poster",
            "detect_faces",
            "extract_geolocation",
          ]),
          status: z.enum([
            "pending",
            "in_progress",
            "succeeded",
            "failed",
            "skipped",
          ]),
          error: z.string().optional(),
          incrementAttempts: z.boolean().optional(),
        })
      )
    )
    .mutation(async ({ input }) => {
      if (input.length === 0) return [];

      // Group items by status to batch updates where possible
      const now = new Date().toISOString();
      const results: Array<{ id: string; status: string } | null> = [];
      const succeededBroadcasts: Array<{ fileId: string; type: string }> = [];

      // Group items with same status and no special fields for batch update
      const simpleSucceeded = input.filter(
        (i) => i.status === "succeeded" && !i.error && !i.incrementAttempts
      );
      const simpleFailed = input.filter(
        (i) => i.status === "failed" && !i.error && !i.incrementAttempts
      );
      const simpleSkipped = input.filter(
        (i) => i.status === "skipped" && !i.error && !i.incrementAttempts
      );
      const complex = input.filter(
        (i) =>
          i.error ||
          i.incrementAttempts ||
          (i.status !== "succeeded" &&
            i.status !== "failed" &&
            i.status !== "skipped")
      );

      // Batch update succeeded items
      if (simpleSucceeded.length > 0) {
        const conditions = simpleSucceeded.map(
          (i) =>
            sql`(${FileTaskTable.fileId} = ${i.fileId} AND ${FileTaskTable.type} = ${i.type})`
        );
        const batchResults = await db
          .update(FileTaskTable)
          .set({ status: "succeeded", finishedAt: now, updatedAt: now })
          .where(sql`${sql.join(conditions, sql` OR `)}`)
          .returning({ id: FileTaskTable.id, status: FileTaskTable.status });
        results.push(...batchResults);
        for (const item of simpleSucceeded) {
          succeededBroadcasts.push({ fileId: item.fileId, type: item.type });
        }
      }

      // Batch update failed items
      if (simpleFailed.length > 0) {
        const conditions = simpleFailed.map(
          (i) =>
            sql`(${FileTaskTable.fileId} = ${i.fileId} AND ${FileTaskTable.type} = ${i.type})`
        );
        const batchResults = await db
          .update(FileTaskTable)
          .set({ status: "failed", finishedAt: now, updatedAt: now })
          .where(sql`${sql.join(conditions, sql` OR `)}`)
          .returning({ id: FileTaskTable.id, status: FileTaskTable.status });
        results.push(...batchResults);
      }

      // Batch update skipped items
      if (simpleSkipped.length > 0) {
        const conditions = simpleSkipped.map(
          (i) =>
            sql`(${FileTaskTable.fileId} = ${i.fileId} AND ${FileTaskTable.type} = ${i.type})`
        );
        const batchResults = await db
          .update(FileTaskTable)
          .set({ status: "skipped", finishedAt: now, updatedAt: now })
          .where(sql`${sql.join(conditions, sql` OR `)}`)
          .returning({ id: FileTaskTable.id, status: FileTaskTable.status });
        results.push(...batchResults);
      }

      // Handle complex items individually (those with error or incrementAttempts)
      for (const item of complex) {
        const update: Record<string, unknown> = {
          status: item.status,
          updatedAt: now,
        };
        if (item.status === "in_progress") {
          update["startedAt"] = now;
          update["progress"] = 0; // Reset progress when starting
        }
        if (
          item.status === "succeeded" ||
          item.status === "failed" ||
          item.status === "skipped"
        ) {
          update["finishedAt"] = now;
          update["progress"] = null; // Clear progress when done
        }
        if (item.error) update["lastError"] = item.error;
        if (item.incrementAttempts)
          update["attempts"] = sql`${FileTaskTable.attempts} + 1`;

        const [row] = await db
          .update(FileTaskTable)
          .set(update)
          .where(
            and(
              eq(FileTaskTable.fileId, item.fileId),
              eq(FileTaskTable.type, item.type)
            )
          )
          .returning({ id: FileTaskTable.id, status: FileTaskTable.status });
        results.push(row ?? null);
        if (item.status === "succeeded") {
          succeededBroadcasts.push({ fileId: item.fileId, type: item.type });
        }
      }

      for (const b of succeededBroadcasts) {
        wsManager.broadcast("file:task-completed", {
          fileId: b.fileId,
          type: b.type,
          status: "succeeded",
        });
      }

      return results;
    }),

  // Atomically lease a batch of files for encode-related work by flipping
  // relevant tasks to in_progress and returning distinct file_ids.
  leaseFilesForEncode: internalProcedure.mutation(async () => {
    const encodeTypes = [
      "encode_thumbnail",
      "encode_optimised",
      "video_poster",
    ] as const;

    // Fetch desired concurrency from system settings (cached — polled per lease)
    const s = await getCachedSystemSettings();
    const desired = Math.max(1, Math.min(64, s?.encodingConcurrency ?? 5));

    const now = new Date().toISOString();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Step 1: Requeue stale in_progress tasks (started > 5 min ago)
    await db
      .update(FileTaskTable)
      .set({
        status: "pending",
        startedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          inArray(FileTaskTable.type, [...encodeTypes]),
          eq(FileTaskTable.status, "in_progress"),
          sql`${FileTaskTable.startedAt} IS NOT NULL`,
          sql`${FileTaskTable.startedAt} < ${fiveMinutesAgo}`
        )
      );

    // Step 2: Find candidate file_ids (pending/failed, attempts < 3)
    const candidates = await db
      .select({
        fileId: FileTaskTable.fileId,
        minUpdated: sql<string>`MIN(${FileTaskTable.updatedAt})`,
      })
      .from(FileTaskTable)
      .where(
        and(
          inArray(FileTaskTable.type, [...encodeTypes]),
          inArray(FileTaskTable.status, ["pending", "failed"]),
          sql`${FileTaskTable.attempts} < 3`
        )
      )
      .groupBy(FileTaskTable.fileId)
      .orderBy(sql`MIN(${FileTaskTable.updatedAt}) ASC`)
      .limit(desired);

    if (candidates.length === 0) return [];

    const candidateFileIds = candidates.map((c) => c.fileId);

    // Step 3: Update tasks for those file_ids to in_progress
    await db
      .update(FileTaskTable)
      .set({
        status: "in_progress",
        startedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(FileTaskTable.fileId, candidateFileIds),
          inArray(FileTaskTable.type, [...encodeTypes]),
          inArray(FileTaskTable.status, ["pending", "failed"]),
          sql`${FileTaskTable.attempts} < 3`
        )
      );

    return candidateFileIds;
  }),

  // Atomically lease a batch of files for face detection. Mirrors
  // leaseFilesForEncode but for the `detect_faces` task, with its own (low)
  // concurrency so the heavy ML model loop never starves encoding. Only leases
  // files whose `encode_optimised` task already succeeded, so the image is known
  // to be a decodable photo by the time we run detection on it.
  leaseFilesForFaceDetection: internalProcedure.mutation(async () => {
    const s = await getCachedSystemSettings();
    const desired = Math.max(1, Math.min(16, s?.faceConcurrency ?? 2));

    const now = new Date().toISOString();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Step 1: Requeue stale in_progress tasks (started > 5 min ago)
    await db
      .update(FileTaskTable)
      .set({ status: "pending", startedAt: null, updatedAt: now })
      .where(
        and(
          eq(FileTaskTable.type, "detect_faces"),
          eq(FileTaskTable.status, "in_progress"),
          sql`${FileTaskTable.startedAt} IS NOT NULL`,
          sql`${FileTaskTable.startedAt} < ${fiveMinutesAgo}`,
        ),
      );

    // Step 2: Find candidate file_ids (pending/failed, attempts < 3) whose
    // optimised encode has succeeded.
    const candidates = await db
      .select({ fileId: FileTaskTable.fileId })
      .from(FileTaskTable)
      .where(
        and(
          eq(FileTaskTable.type, "detect_faces"),
          inArray(FileTaskTable.status, ["pending", "failed"]),
          sql`${FileTaskTable.attempts} < 3`,
          sql`EXISTS (
            SELECT 1 FROM ${FileTaskTable} opt
            WHERE opt.file_id = ${FileTaskTable.fileId}
            AND opt.type = 'encode_optimised'
            AND opt.status = 'succeeded'
          )`,
        ),
      )
      .orderBy(sql`${FileTaskTable.updatedAt} ASC`)
      .limit(desired);

    if (candidates.length === 0) return [];

    const candidateFileIds = candidates.map((c) => c.fileId);

    // Step 3: Flip those tasks to in_progress
    await db
      .update(FileTaskTable)
      .set({ status: "in_progress", startedAt: now, updatedAt: now })
      .where(
        and(
          eq(FileTaskTable.type, "detect_faces"),
          inArray(FileTaskTable.fileId, candidateFileIds),
          inArray(FileTaskTable.status, ["pending", "failed"]),
          sql`${FileTaskTable.attempts} < 3`,
        ),
      );

    return candidateFileIds;
  }),

  // Atomically lease a batch of files for GPS extraction. Mirrors
  // leaseFilesForEncode but for the cheap `extract_geolocation` task. Reads only
  // EXIF / ffprobe tags off the original file (no transcode), so it gets a higher
  // batch size and runs independently of the encode + face loops.
  leaseFilesForGeolocation: internalProcedure.mutation(async () => {
    const desired = 16;

    const now = new Date().toISOString();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Step 1: Requeue stale in_progress tasks (started > 5 min ago)
    await db
      .update(FileTaskTable)
      .set({ status: "pending", startedAt: null, updatedAt: now })
      .where(
        and(
          eq(FileTaskTable.type, "extract_geolocation"),
          eq(FileTaskTable.status, "in_progress"),
          sql`${FileTaskTable.startedAt} IS NOT NULL`,
          sql`${FileTaskTable.startedAt} < ${fiveMinutesAgo}`,
        ),
      );

    // Step 2: Find candidate file_ids (pending/failed, attempts < 3)
    const candidates = await db
      .select({ fileId: FileTaskTable.fileId })
      .from(FileTaskTable)
      .where(
        and(
          eq(FileTaskTable.type, "extract_geolocation"),
          inArray(FileTaskTable.status, ["pending", "failed"]),
          sql`${FileTaskTable.attempts} < 3`,
        ),
      )
      .orderBy(sql`${FileTaskTable.updatedAt} ASC`)
      .limit(desired);

    if (candidates.length === 0) return [];

    const candidateFileIds = candidates.map((c) => c.fileId);

    // Step 3: Flip those tasks to in_progress
    await db
      .update(FileTaskTable)
      .set({ status: "in_progress", startedAt: now, updatedAt: now })
      .where(
        and(
          eq(FileTaskTable.type, "extract_geolocation"),
          inArray(FileTaskTable.fileId, candidateFileIds),
          inArray(FileTaskTable.status, ["pending", "failed"]),
          sql`${FileTaskTable.attempts} < 3`,
        ),
      );

    return candidateFileIds;
  }),

  // Revive encode tasks that died at the attempt cap so a deploy that fixes the
  // underlying failure (e.g. a stricter image decoder) re-drives them instead of
  // leaving them permanently failed. Run once on worker boot. Genuinely-bad
  // files simply re-exhaust their (bounded) attempts again.
  reviveDeadEncodeTasks: internalProcedure.mutation(async () => {
    const now = new Date().toISOString();
    const revived = await db
      .update(FileTaskTable)
      .set({
        status: "pending",
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        progress: 0,
        updatedAt: now,
      })
      .where(
        and(
          inArray(FileTaskTable.type, [
            "encode_thumbnail",
            "encode_optimised",
            "video_poster",
          ]),
          eq(FileTaskTable.status, "failed"),
          sql`${FileTaskTable.attempts} >= 3`,
        ),
      )
      .returning({ id: FileTaskTable.id });
    return { revived: revived.length };
  }),

  // Admin: re-run encoding for a whole media type after changing quality/codec
  // settings. Quality-aware by design:
  //  - images: just reset the encode tasks to pending. The worker re-encodes
  //    only files whose stored variant quality differs from the new setting
  //    (unchanged files are a fast no-op), and the existing variant keeps being
  //    served until its replacement is written — so the gallery never flashes
  //    broken thumbnails.
  //  - videos: variants carry no quality marker and the worker reuses any
  //    on-disk variant, so a settings change can't be detected. We force a true
  //    re-encode by deleting the existing variant files (disk + DB rows), then
  //    resetting the tasks so they regenerate from the originals.
  reencode: adminProcedure
    .input(z.object({ target: z.enum(["images", "videos"]) }))
    .mutation(async ({ input }) => {
      const now = new Date().toISOString();
      const resetFields = {
        status: "pending" as const,
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        progress: 0,
        updatedAt: now,
      };

      if (input.target === "images") {
        const imageIds = db
          .select({ id: FileTable.id })
          .from(FileTable)
          .where(eq(FileTable.type, "image"));

        const reset = await db
          .update(FileTaskTable)
          .set(resetFields)
          .where(
            and(
              inArray(FileTaskTable.type, [
                "encode_thumbnail",
                "encode_optimised",
              ]),
              inArray(FileTaskTable.fileId, imageIds),
            ),
          )
          .returning({ id: FileTaskTable.id });

        return {
          target: "images" as const,
          tasksReset: reset.length,
          variantsDeleted: 0,
        };
      }

      // videos: force a full regenerate.
      const videoRows = await db
        .select({ id: FileTable.id })
        .from(FileTable)
        .where(eq(FileTable.type, "video"));
      const videoIds = videoRows.map((r) => r.id);

      if (videoIds.length === 0) {
        return { target: "videos" as const, tasksReset: 0, variantsDeleted: 0 };
      }

      // Resolve the on-disk variant files (thumb/opt) so they can't be reused.
      const variantFiles = await db
        .select({
          variantFileId: FileVariantTable.fileId,
          dir: FileTable.dir,
          name: FileTable.name,
        })
        .from(FileVariantTable)
        .innerJoin(FileTable, eq(FileTable.id, FileVariantTable.fileId))
        .where(inArray(FileVariantTable.originalFileId, videoIds));

      let variantsDeleted = 0;
      for (const v of variantFiles) {
        try {
          const abs = await resolveAssetPath(
            path.resolve(path.join(v.dir, v.name)),
          );
          await fs.promises.unlink(abs);
          variantsDeleted++;
        } catch {
          // Best-effort: a missing file just means it's already gone.
        }
      }

      // Drop the variant rows (link rows first, then the variant file rows).
      await db
        .delete(FileVariantTable)
        .where(inArray(FileVariantTable.originalFileId, videoIds));
      const variantFileIds = variantFiles.map((v) => v.variantFileId);
      if (variantFileIds.length > 0) {
        await db
          .delete(FileTable)
          .where(inArray(FileTable.id, variantFileIds));
      }

      const reset = await db
        .update(FileTaskTable)
        .set(resetFields)
        .where(
          and(
            inArray(FileTaskTable.type, ["video_poster", "encode_optimised"]),
            inArray(FileTaskTable.fileId, videoIds),
          ),
        )
        .returning({ id: FileTaskTable.id });

      return {
        target: "videos" as const,
        tasksReset: reset.length,
        variantsDeleted,
      };
    }),

  // Update progress for a task (used during video encoding)
  setProgress: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        type: z.enum([
          "encode_thumbnail",
          "encode_optimised",
          "video_poster",
          "detect_faces",
          "extract_geolocation",
        ]),
        progress: z.number().int().min(0).max(100),
      })
    )
    .mutation(async ({ input }) => {
      const now = new Date().toISOString();
      const [row] = await db
        .update(FileTaskTable)
        .set({ progress: input.progress, updatedAt: now })
        .where(
          and(
            eq(FileTaskTable.fileId, input.fileId),
            eq(FileTaskTable.type, input.type)
          )
        )
        .returning({ id: FileTaskTable.id, progress: FileTaskTable.progress });
      return row ?? null;
    }),

  // List outstanding encode-related tasks per file (attempts <3 and not succeeded)
  listOutstanding: privateProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 50;
      const offset = (page - 1) * pageSize;

      const encodeTypes = [
        "encode_thumbnail",
        "encode_optimised",
        "video_poster",
      ] as const;

      // Get total count of distinct fileIds
      const [countResult] = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${FileTaskTable.fileId})` })
        .from(FileTaskTable)
        .where(
          and(
            inArray(FileTaskTable.type, [...encodeTypes]),
            inArray(FileTaskTable.status, ["pending", "in_progress", "failed"]),
            sql`${FileTaskTable.attempts} < 3`
          )
        );
      const totalFiles = Number(countResult?.count ?? 0);
      const totalPages = Math.ceil(totalFiles / pageSize);

      // Get paginated distinct fileIds
      const fileIdRows = await db
        .selectDistinct({ fileId: FileTaskTable.fileId })
        .from(FileTaskTable)
        .where(
          and(
            inArray(FileTaskTable.type, [...encodeTypes]),
            inArray(FileTaskTable.status, ["pending", "in_progress", "failed"]),
            sql`${FileTaskTable.attempts} < 3`
          )
        )
        .orderBy(FileTaskTable.fileId)
        .limit(pageSize)
        .offset(offset);

      if (fileIdRows.length === 0) {
        return { items: [], page, pageSize, totalFiles, totalPages };
      }

      const fileIds = fileIdRows.map((r) => r.fileId);

      // Get tasks for those fileIds
      const rows = await db
        .select({
          fileId: FileTaskTable.fileId,
          type: FileTaskTable.type,
          status: FileTaskTable.status,
          attempts: FileTaskTable.attempts,
          lastError: FileTaskTable.lastError,
          progress: FileTaskTable.progress,
          updatedAt: FileTaskTable.updatedAt,
        })
        .from(FileTaskTable)
        .where(
          and(
            inArray(FileTaskTable.fileId, fileIds),
            inArray(FileTaskTable.type, [...encodeTypes]),
            inArray(FileTaskTable.status, ["pending", "in_progress", "failed"]),
            sql`${FileTaskTable.attempts} < 3`
          )
        )
        .orderBy(FileTaskTable.updatedAt);

      // Group by fileId in JS
      const grouped = new Map<
        string,
        Array<{
          type: string;
          status: string;
          attempts: number;
          lastError: string | null;
          progress: number | null;
        }>
      >();
      for (const r of rows) {
        if (!grouped.has(r.fileId)) grouped.set(r.fileId, []);
        grouped.get(r.fileId)!.push({
          type: r.type!,
          status: r.status!,
          attempts: r.attempts,
          lastError: r.lastError,
          progress: r.progress ?? 0,
        });
      }

      const items = Array.from(grouped.entries()).map(([fileId, tasks]) => ({
        fileId,
        tasks,
      }));

      return { items, page, pageSize, totalFiles, totalPages };
    }),
});
