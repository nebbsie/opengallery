import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTaskTable, SystemSettingsTable } from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

export const fileTaskRouter = router({
  getCountsByType: internalProcedure.query(async () => {
    const rows = await db.execute(
      sql<{
        type: string;
        status: string;
        count: number;
      }>`
        SELECT type::text, status::text, COUNT(*)::int AS count
        FROM ${FileTaskTable}
        GROUP BY type, status
      `
    );
    return rows.rows.map((r) => ({
      type: r["type"],
      status: r["status"],
      count: Number(r["count"]),
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
      const update: any = { status: input.status, updatedAt: new Date() };
      if (input.status === "in_progress") update.startedAt = new Date();
      if (
        input.status === "succeeded" ||
        input.status === "failed" ||
        input.status === "skipped"
      )
        update.finishedAt = new Date();
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
      const update: any = { status: input.status, updatedAt: new Date() };
      if (input.status === "in_progress") update.startedAt = new Date();
      if (
        input.status === "succeeded" ||
        input.status === "failed" ||
        input.status === "skipped"
      )
        update.finishedAt = new Date();
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
      return db.transaction(async (tx) => {
        const results: Array<{ id: string; status: string } | null> = [];
        for (const item of input) {
          const update: any = { status: item.status, updatedAt: new Date() };
          if (item.status === "in_progress") update.startedAt = new Date();
          if (
            item.status === "succeeded" ||
            item.status === "failed" ||
            item.status === "skipped"
          )
            update.finishedAt = new Date();
          if (item.error) update.lastError = item.error;
          if (item.incrementAttempts)
            update.attempts = sql`${FileTaskTable.attempts} + 1` as any;

          const [row] = await tx
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
      });
    }),

  // Atomically lease a batch of files for encode-related work by flipping
  // relevant tasks to in_progress and returning distinct file_ids.
  leaseFilesForEncode: internalProcedure.mutation(async () => {
    const encodeTypes = [
      "encode_thumbnail",
      "encode_optimised",
      "video_poster",
    ];

    // Fetch desired concurrency from system settings
    const [s] = await db
      .select({ encodingConcurrency: SystemSettingsTable.encodingConcurrency })
      .from(SystemSettingsTable)
      .limit(1);
    const desired = s?.encodingConcurrency ?? 5;

    const rows = await db.execute(
      sql<{ file_id: string }>`
        WITH requeue AS (
          UPDATE ${FileTaskTable} ft
          SET status = 'pending', started_at = NULL, "updatedAt" = now()
          WHERE ft.type IN ('encode_thumbnail','encode_optimised','video_poster')
            AND ft.status = 'in_progress'
            AND ft.started_at IS NOT NULL
            AND ft.started_at < now() - interval '5 minutes'
          RETURNING 1
        ), candidates AS (
          SELECT file_id, MIN("updatedAt") AS min_updated
          FROM ${FileTaskTable}
          WHERE type IN ('encode_thumbnail','encode_optimised','video_poster')
            AND status IN ('pending','failed')
            AND attempts < 3
          GROUP BY file_id
          ORDER BY min_updated ASC
          LIMIT ${desired}
        ), upd AS (
          UPDATE ${FileTaskTable} ft
          SET status = 'in_progress', started_at = now(), "updatedAt" = now()
          FROM candidates c
          WHERE ft.file_id = c.file_id
            AND ft.type IN ('encode_thumbnail','encode_optimised','video_poster')
            AND ft.status IN ('pending','failed')
            AND ft.attempts < 3
          RETURNING ft.file_id
        )
        SELECT DISTINCT file_id FROM upd
      `
    );

    const fileIds = Array.from(
      new Set(rows.rows.map((r) => r["file_id"] as string))
    );
    return fileIds;
  }),

  // List outstanding encode-related tasks per file (attempts <3 and not succeeded)
  listOutstanding: privateProcedure.query(async () => {
    const rows = await db.execute(
      sql<{
        file_id: string;
        statuses: unknown;
      }>`
        SELECT file_id,
               json_agg(json_build_object('type', type::text, 'status', status::text, 'attempts', attempts, 'lastError', last_error)) AS statuses
        FROM ${FileTaskTable}
        WHERE type IN ('encode_thumbnail','encode_optimised','video_poster')
          AND status IN ('pending','in_progress','failed')
          AND attempts < 3
        GROUP BY file_id
        ORDER BY MIN("updatedAt") ASC
      `
    );
    return rows.rows.map((r) => ({
      fileId: r["file_id"] as string,
      tasks: r["statuses"] as any,
    }));
  }),
});
