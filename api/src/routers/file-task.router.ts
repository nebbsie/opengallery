import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTaskTable, SystemSettingsTable } from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

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
        type: z.enum(["encode_thumbnail", "encode_optimised", "video_poster"]),
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
        type: z.enum(["encode_thumbnail", "encode_optimised", "video_poster"]),
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

    // Fetch desired concurrency from system settings
    const [s] = await db
      .select({ encodingConcurrency: SystemSettingsTable.encodingConcurrency })
      .from(SystemSettingsTable)
      .limit(1);
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

  // Update progress for a task (used during video encoding)
  setProgress: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        type: z.enum(["encode_thumbnail", "encode_optimised", "video_poster"]),
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
