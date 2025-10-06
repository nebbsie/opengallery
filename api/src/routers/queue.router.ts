import { TasksQueue } from "../redis.js";
import { privateProcedure, router } from "../trpc.js";

type QueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  paused: number;
  completed: number;
  failed: number;
};

export const queueRouter = router({
  encodingCounts: privateProcedure.query(async () => {
    // Return key counts relevant to user-visible progress
    const jobCounts = await TasksQueue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "paused",
      "completed",
      "failed"
    );

    const counts: QueueCounts = {
      waiting: jobCounts["waiting"] ?? 0,
      active: jobCounts["active"] ?? 0,
      delayed: jobCounts["delayed"] ?? 0,
      paused: jobCounts["paused"] ?? 0,
      completed: jobCounts["completed"] ?? 0,
      failed: jobCounts["failed"] ?? 0,
    };

    const totalPending = counts.waiting + counts.active + counts.delayed;
    return { counts, totalPending };
  }),
});
