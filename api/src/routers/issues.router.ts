import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTaskTable } from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

export const issuesRouter = router({
  list: privateProcedure.query(async () => {
    const encodeTypes = [
      "encode_thumbnail",
      "encode_optimised",
      "video_poster",
    ] as const;

    const rows = await db
      .select({
        fileId: FileTaskTable.fileId,
        attempts: sql<number>`MAX(${FileTaskTable.attempts})`,
      })
      .from(FileTaskTable)
      .where(
        and(
          inArray(FileTaskTable.type, [...encodeTypes]),
          sql`${FileTaskTable.attempts} >= 3`
        )
      )
      .groupBy(FileTaskTable.fileId)
      .orderBy(desc(sql`MAX(${FileTaskTable.attempts})`));

    return rows.map((r) => ({
      fileId: r.fileId,
      attempts: Number(r.attempts),
    }));
  }),

  retry: privateProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const encodeTypes = [
        "encode_thumbnail",
        "encode_optimised",
        "video_poster",
      ] as const;

      await db
        .update(FileTaskTable)
        .set({
          status: "pending",
          attempts: 0,
          lastError: null,
          updatedAt: new Date().toISOString(),
          startedAt: null,
          finishedAt: null,
        })
        .where(
          and(
            eq(FileTaskTable.fileId, input.fileId),
            inArray(FileTaskTable.type, [...encodeTypes])
          )
        );
      return { ok: true } as const;
    }),

  retryAll: privateProcedure.mutation(async () => {
    const encodeTypes = [
      "encode_thumbnail",
      "encode_optimised",
      "video_poster",
    ] as const;

    const result = await db
      .update(FileTaskTable)
      .set({
        status: "pending",
        attempts: 0,
        lastError: null,
        updatedAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
      })
      .where(
        and(
          inArray(FileTaskTable.type, [...encodeTypes]),
          sql`${FileTaskTable.attempts} >= 3`
        )
      )
      .returning({ fileId: FileTaskTable.fileId });

    return { ok: true, count: result.length } as const;
  }),
});
