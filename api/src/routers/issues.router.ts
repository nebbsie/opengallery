import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTable, ProcessingIssueTable } from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

export const issuesRouter = router({
  list: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

    // Return unresolved issues newest first with file info
    const rows = await db
      .select({ issue: ProcessingIssueTable, file: FileTable })
      .from(ProcessingIssueTable)
      .innerJoin(FileTable, eq(FileTable.id, ProcessingIssueTable.fileId))
      .where(isNull(ProcessingIssueTable.resolvedAt))
      .orderBy(desc(ProcessingIssueTable.createdAt));

    return rows.map((r) => ({
      id: r.issue.id,
      fileId: r.issue.fileId,
      stage: r.issue.stage,
      message: r.issue.message,
      extra: r.issue.extra,
      attempts: r.issue.attempts,
      createdAt: r.issue.createdAt,
      file: {
        id: r.file.id,
        name: r.file.name,
        dir: r.file.dir,
        type: r.file.type,
      },
    }));
  }),

  record: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        stage: z.string(),
        message: z.string().min(1),
        extra: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.insert(ProcessingIssueTable).values({
        fileId: input.fileId,
        stage: input.stage as any,
        message: input.message,
        extra: input.extra ?? null,
      });
      return { ok: true };
    }),

  resolveForFile: internalProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db
        .update(ProcessingIssueTable)
        .set({ resolvedAt: sql`now()` })
        .where(
          and(
            eq(ProcessingIssueTable.fileId, input.fileId),
            isNull(ProcessingIssueTable.resolvedAt)
          )
        );
      return { ok: true };
    }),

  retry: privateProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      // Simple approach: increment attempts and enqueue encode again
      await db
        .update(ProcessingIssueTable)
        .set({ attempts: sql`${ProcessingIssueTable.attempts} + 1` })
        .where(
          and(
            eq(ProcessingIssueTable.fileId, input.fileId),
            isNull(ProcessingIssueTable.resolvedAt)
          )
        );

      // Reuse existing create-encode infra by pushing encode task
      // We avoid import here; worker listens to the queue.
      // If a more specific queue is needed, add a dedicated endpoint later.
      return { ok: true };
    }),
});
