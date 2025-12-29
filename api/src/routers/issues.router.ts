import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTaskTable } from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

export const issuesRouter = router({
  list: privateProcedure.query(async () => {
    const rows = await db.execute(
      sql<{
        file_id: string;
        attempts: number;
      }>`
        SELECT ft.file_id, MAX(ft.attempts)::int AS attempts
        FROM ${FileTaskTable} ft
        WHERE ft.type IN ('encode_thumbnail','encode_optimised','video_poster')
          AND ft.attempts >= 3
        GROUP BY ft.file_id
        ORDER BY attempts DESC
      `
    );
    return rows.rows.map((r) => ({
      fileId: r["file_id"],
      attempts: Number(r["attempts"]),
    }));
  }),

  record: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        stage: z.string(),
        message: z.string(),
        extra: z.any().optional(),
      })
    )
    .mutation(async () => {
      return { ok: true } as const;
    }),

  resolveForFile: internalProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async () => {
      return { ok: true } as const;
    }),

  retry: privateProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.execute(sql`
        UPDATE ${FileTaskTable}
        SET status = 'pending', attempts = 0, last_error = NULL, "updatedAt" = now(), started_at = NULL, finished_at = NULL
        WHERE file_id = ${input.fileId}
          AND type IN ('encode_thumbnail','encode_optimised','video_poster')
      `);
      return { ok: true } as const;
    }),
});
