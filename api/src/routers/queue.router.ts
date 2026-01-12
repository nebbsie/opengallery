import { and, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { FileTaskTable } from "../db/schema.js";
import { privateProcedure, router } from "../trpc.js";

export const queueRouter = router({
  // Returns total distinct files with any non-succeeded tasks (i.e., work remaining)
  encodingCounts: privateProcedure.query(async () => {
    const statuses = ["pending", "in_progress", "failed"] as const;

    const totalRes = await db
      .select({
        total: sql<number>`COUNT(DISTINCT ${FileTaskTable.fileId})`,
      })
      .from(FileTaskTable)
      .where(
        and(
          inArray(FileTaskTable.status, [...statuses]),
          sql`${FileTaskTable.attempts} < 3`
        )
      );

    // Breakdown (distinct file_ids per status)
    const byStatusRes = await db
      .select({
        status: FileTaskTable.status,
        count: sql<number>`COUNT(DISTINCT ${FileTaskTable.fileId})`,
      })
      .from(FileTaskTable)
      .where(
        and(
          inArray(FileTaskTable.status, [...statuses]),
          sql`${FileTaskTable.attempts} < 3`
        )
      )
      .groupBy(FileTaskTable.status);

    const totalPending = Number(totalRes[0]?.total ?? 0);
    const counts: Record<string, number> = {};
    byStatusRes.forEach((r) => (counts[r.status!] = Number(r.count)));

    return {
      counts: {
        waiting: counts["pending"] ?? 0,
        active: counts["in_progress"] ?? 0,
        failed: counts["failed"] ?? 0,
      },
      totalPending,
    } as const;
  }),
});
