import { type SQL, and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type SessionLike,
  buildFileAccessFilter,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { FileTaskTable } from "../db/schema.js";
import { privateProcedure, router } from "../trpc.js";

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

export const issuesRouter = router({
  list: privateProcedure.query(async ({ ctx: { userId, session } }) => {
    const owned = await ownedTaskFilter(userId, session);
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
          sql`${FileTaskTable.attempts} >= 3`,
          owned
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
    .mutation(async ({ ctx: { userId, session }, input }) => {
      const owned = await ownedTaskFilter(userId, session);
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
            inArray(FileTaskTable.type, [...encodeTypes]),
            owned
          )
        );
      return { ok: true } as const;
    }),

  retryAll: privateProcedure.mutation(async ({ ctx: { userId, session } }) => {
    const owned = await ownedTaskFilter(userId, session);
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
          sql`${FileTaskTable.attempts} >= 3`,
          owned
        )
      )
      .returning({ fileId: FileTaskTable.fileId });

    return { ok: true, count: result.length } as const;
  }),
});
