import { and, sql } from "drizzle-orm";
import {
  buildFileAccessFilter,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { FileTaskTable } from "../db/schema.js";
import { privateProcedure, router } from "../trpc.js";
import { taskQueued, taskRunning } from "../utils/task-queue.js";

// The admin count is the same for every admin, and every open admin tab polls
// it every 10s. Compute it at most once per TTL.
const ADMIN_COUNT_TTL_MS = 5_000;
let adminCount: { value: number; expires: number } | null = null;

export const queueRouter = router({
  // Returns total distinct files with any outstanding task: pending, in
  // progress, or failed under the retry cap (i.e., work remaining).
  // A non-admin only counts files they can see, so a hidden file being
  // processed never shows up in their "processing" badge.
  encodingCounts: privateProcedure.query(async ({ ctx: { userId, session } }) => {
    const scope = userId ? await getAccessScope(userId, session) : null;
    const isAdmin = !scope || scope.isAdmin;
    if (isAdmin && adminCount && adminCount.expires > Date.now()) {
      return { totalPending: adminCount.value } as const;
    }
    const scopeFilter = scope
      ? buildFileAccessFilter(scope, FileTaskTable.fileId)
      : sql`1 = 1`;

    // UNION of the queued rows (file_task_queue_idx) and the running rows
    // (file_task_type_status_idx); UNION drops the duplicate file ids. One
    // OR of the two would stop SQLite from using the partial index.
    const outstanding = db
      .select({ fileId: FileTaskTable.fileId })
      .from(FileTaskTable)
      .where(and(taskQueued, scopeFilter))
      .union(
        db
          .select({ fileId: FileTaskTable.fileId })
          .from(FileTaskTable)
          .where(and(taskRunning, scopeFilter)),
      )
      .as("outstanding");
    const [row] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(outstanding);
    const totalPending = Number(row?.total ?? 0);

    if (isAdmin) {
      adminCount = { value: totalPending, expires: Date.now() + ADMIN_COUNT_TTL_MS };
    }
    return { totalPending } as const;
  }),
});
