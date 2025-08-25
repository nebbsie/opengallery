import { Queue } from "bullmq";

const connection = {
  url: process.env["REDIS_URL"] ?? "redis://redis:6379",
  maxRetriesPerRequest: null,
};

export const TasksQueue = new Queue("tasks", { connection });
