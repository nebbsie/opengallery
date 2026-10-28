import { and, inArray, sql } from "drizzle-orm";
import {
  buildFileAccessFilter,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { FileTaskTable } from "../db/schema.js";
import { privateProcedure, router } from "../trpc.js";

export const queueRouter = router({
  // Returns total distinct files with any non-succeeded tasks (i.e., work remaining)
  // A non-admin only counts files they can see, so a hidden file being
  // processed never shows up in their "processing" badge.
  encodingCounts: privateProcedure.query(async ({ ctx: { userId, session } }) => {
    const statuses = ["pending", "in_progress", "failed"] as const;
    const scopeFilter = userId
      ? buildFileAccessFilter(
          await getAccessScope(userId, session),
          FileTaskTable.fileId,
        )
      : sql`1 = 1`;

    const totalRes = await db
      .select({
        total: sql<number>`COUNT(DISTINCT ${FileTaskTable.fileId})`,
      })
      .from(FileTaskTable)
      .where(
        and(
          inArray(FileTaskTable.status, [...statuses]),
          sql`${FileTaskTable.attempts} < 3`,
          scopeFilter
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
          sql`${FileTaskTable.attempts} < 3`,
          scopeFilter
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
