import type { FileTaskStatus } from '../db/schema.js';

export type TaskUpdate = {
  status: FileTaskStatus;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
  attempts?: unknown;
};

export function buildTaskStatusUpdate(
  status: FileTaskStatus,
  sql: <T>(template: TemplateStringsArray, ...values: unknown[]) => unknown,
  error?: string,
  incrementAttempts = false
): TaskUpdate {
  const now = new Date().toISOString();
  const update: TaskUpdate = {
    status,
    updatedAt: now,
  };

  if (status === 'in_progress') {
    update.startedAt = now;
  }

  if (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'skipped'
  ) {
    update.finishedAt = now;
  }

  if (error) {
    update.lastError = error;
  }

  if (incrementAttempts) {
    update.attempts = sql`${'attempts'} + 1`;
  }

  return update;
}
