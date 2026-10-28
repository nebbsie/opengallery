import { type SQL, and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type SessionLike,
  buildFileAccessFilter,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { FileTable, FileTaskTable } from "../db/schema.js";
import { adminProcedure, router } from "../trpc.js";
import { trashFiles } from "../utils/media-edit.js";

// Restrict task rows to files in libraries the caller owns. Admins and the
// internal worker are unrestricted. Shared (view-only) access is not enough to
// list or reset another user's encode tasks.
async function ownedTaskFilter(
  userId: string | null,
  session: SessionLike,
): Promise<SQL> {
  if (!userId) return sql`1 = 1`;
  const scope = await getAccessScope(userId, session);
  return buildFileAccessFilter(
    {
      ...scope,
      accessibleLibraryIds: scope.ownedLibraryIds,
      recursiveAlbumIds: new Set(),
      directFileIds: new Set(),
    },
    FileTaskTable.fileId,
  );
}

const ENCODE_TYPES = ["encode_thumbnail", "encode_optimised", "video_poster"] as const;

// An issue: an encode task that failed at the retry cap, or that the encoder
// skipped with an error (an empty or undecodable file).
// The status list lets file_task_type_status_idx seek instead of a full scan.
const isIssue = and(
  inArray(FileTaskTable.status, ["failed", "skipped"]),
  or(
    sql`${FileTaskTable.attempts} >= 3`,
    and(eq(FileTaskTable.status, "skipped"), sql`${FileTaskTable.lastError} IS NOT NULL`),
  ),
)!;

// ffmpeg and libvips errors start with a long version banner. The last lines
// say what went wrong, e.g. "Invalid data found when processing input".
function errorLines(error: string | null): string[] {
  if (!error) return [];
  return error
    .split("\n")
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean);
}
function shortError(error: string | null): string | null {
  const last = errorLines(error).at(-1);
  if (!last) return null;
  return last.replace(/^Error opening input files?:\s*/, "");
}

// Settings > Issues is an admin page: the failed tasks are system data.
export const issuesRouter = router({
  list: adminProcedure.query(async ({ ctx: { userId, session } }) => {
    const owned = await ownedTaskFilter(userId, session);
    const rows = await db
      .select({
        fileId: FileTaskTable.fileId,
        attempts: sql<number>`MAX(${FileTaskTable.attempts})`,
        types: sql<string>`GROUP_CONCAT(DISTINCT ${FileTaskTable.type})`,
        lastError: sql<string | null>`MAX(${FileTaskTable.lastError})`,
        updatedAt: sql<string>`MAX(${FileTaskTable.updatedAt})`,
        name: FileTable.name,
        dir: FileTable.dir,
        type: FileTable.type,
        mime: FileTable.mime,
        size: FileTable.size,
      })
      .from(FileTaskTable)
      .innerJoin(FileTable, eq(FileTable.id, FileTaskTable.fileId))
      .where(and(inArray(FileTaskTable.type, [...ENCODE_TYPES]), isIssue, owned))
      .groupBy(FileTaskTable.fileId)
      .orderBy(desc(sql`MAX(${FileTaskTable.attempts})`), FileTable.dir, FileTable.name);

    return rows.map((r) => ({
      fileId: r.fileId,
      attempts: Number(r.attempts),
      tasks: (r.types ?? "").split(",").filter(Boolean),
      error: shortError(r.lastError),
      errorDetail: errorLines(r.lastError).slice(-6).join("\n") || null,
      updatedAt: r.updatedAt,
      name: r.name,
      dir: r.dir,
      type: r.type,
      mime: r.mime,
      size: r.size,
    }));
  }),

  // Delete files: move the originals to the trash, then remove them from the
  // library. A file that cannot move stays listed, with the reason.
  remove: adminProcedure
    .input(z.object({ fileIds: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      const owned = await ownedTaskFilter(userId, session);
      // Only files that are on this page.
      const rows = await db
        .selectDistinct({ id: FileTaskTable.fileId })
        .from(FileTaskTable)
        .where(
          and(
            inArray(FileTaskTable.fileId, input.fileIds),
            inArray(FileTaskTable.type, [...ENCODE_TYPES]),
            isIssue,
            owned,
          ),
        );
      return trashFiles(
        rows.map((r) => r.id),
        userId,
      );
    }),

  retry: adminProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      const owned = await ownedTaskFilter(userId, session);
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
            inArray(FileTaskTable.type, [...ENCODE_TYPES]),
            owned
          )
        );
      return { ok: true } as const;
    }),

  retryAll: adminProcedure.mutation(async ({ ctx: { userId, session } }) => {
    const owned = await ownedTaskFilter(userId, session);
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
          inArray(FileTaskTable.type, [...ENCODE_TYPES]),
          sql`${FileTaskTable.attempts} >= 3`,
          owned
        )
      )
      .returning({ fileId: FileTaskTable.fileId });

    return { ok: true, count: result.length } as const;
  }),
});
