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
      const update: any = { status: input.status, updatedAt: now };
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
      const update: any = { status: input.status, updatedAt: now };
      if (input.status === "in_progress") update.startedAt = now;
      if (
        input.status === "succeeded" ||
        input.status === "failed" ||
        input.status === "skipped"
      )
        update.finishedAt = now;
      if (input.error) update.lastError = input.error;
      if (input.incrementAttempts)
        update.attempts = sql`${FileTaskTable.attempts} + 1` as any;

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
      const results: Array<{ id: string; status: string } | null> = [];
      for (const item of input) {
        const now = new Date().toISOString();
        const update: any = { status: item.status, updatedAt: now };
        if (item.status === "in_progress") update.startedAt = now;
        if (
          item.status === "succeeded" ||
          item.status === "failed" ||
          item.status === "skipped"
        )
          update.finishedAt = now;
        if (item.error) update.lastError = item.error;
        if (item.incrementAttempts)
          update.attempts = sql`${FileTaskTable.attempts} + 1` as any;

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
    const desired = s?.encodingConcurrency ?? 5;

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

  // List outstanding encode-related tasks per file (attempts <3 and not succeeded)
  listOutstanding: privateProcedure.query(async () => {
    const encodeTypes = [
      "encode_thumbnail",
      "encode_optimised",
      "video_poster",
    ] as const;

    const rows = await db
      .select({
        fileId: FileTaskTable.fileId,
        type: FileTaskTable.type,
        status: FileTaskTable.status,
        attempts: FileTaskTable.attempts,
        lastError: FileTaskTable.lastError,
        updatedAt: FileTaskTable.updatedAt,
      })
      .from(FileTaskTable)
      .where(
        and(
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
      }>
    >();
    for (const r of rows) {
      if (!grouped.has(r.fileId)) grouped.set(r.fileId, []);
      grouped.get(r.fileId)!.push({
        type: r.type!,
        status: r.status!,
        attempts: r.attempts,
        lastError: r.lastError,
      });
    }

    return Array.from(grouped.entries()).map(([fileId, tasks]) => ({
      fileId,
      tasks,
    }));
  }),
});
