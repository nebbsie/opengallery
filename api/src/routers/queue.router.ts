import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { FileTaskTable } from "../db/schema.js";
import { privateProcedure, router } from "../trpc.js";

export const queueRouter = router({
  // Returns total distinct files with any non-succeeded tasks (i.e., work remaining)
  encodingCounts: privateProcedure.query(async () => {
    const totalRes = await db.execute(
      sql<{ total: number }>`
        SELECT COUNT(DISTINCT file_id)::int AS total
        FROM ${FileTaskTable}
        WHERE status IN ('pending','in_progress','failed')
          AND attempts < 3
      `
    );

    // Breakdown (distinct file_ids per status)
    const byStatusRes = await db.execute(
      sql<{ status: string; count: number }>`
        SELECT status::text, COUNT(DISTINCT file_id)::int AS count
        FROM ${FileTaskTable}
        WHERE status IN ('pending','in_progress','failed')
          AND attempts < 3
        GROUP BY status
      `
    );

    const totalPending = Number(totalRes.rows[0]?.["total"] ?? 0);
    const counts: Record<string, number> = {};
    byStatusRes.rows.forEach(
      (r) => (counts[r["status"] as string] = Number(r["count"]))
    );

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
