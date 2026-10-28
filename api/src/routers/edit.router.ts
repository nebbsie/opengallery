import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAccessScope } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { FileTable, UploadSessionTable } from "../db/schema.js";
import { adminProcedure, privateProcedure, router } from "../trpc.js";
import { renameFolder, setAlbumCover, trashFiles, trashFolder } from "../utils/media-edit.js";
import { describeWriteError } from "../utils/media-trash.js";

// Library edits that change the media folder too (utils/media-edit.ts).
// Admin-only, except that a user may delete the files they uploaded (for
// example into a collaborative album).

// Edits run one at a time, so two requests never move the same paths.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const asBadRequest = (e: unknown) =>
  new TRPCError({ code: "BAD_REQUEST", message: describeWriteError(e), cause: e });

export const editRouter = router({
  // Move files to the trash and remove them from the library. A photo's RAW
  // companion goes with it.
  deleteFiles: privateProcedure
    .input(z.object({ fileIds: z.array(z.string().uuid()).min(1).max(5000) }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      if (scope.isAdmin) return serial(() => trashFiles(input.fileIds, userId));

      // Not an admin: only files this user uploaded.
      const own = new Set<string>();
      for (let i = 0; i < input.fileIds.length; i += 500) {
        const rows = await db
          .select({ fileId: UploadSessionTable.fileId })
          .from(UploadSessionTable)
          .where(
            and(
              eq(UploadSessionTable.userId, userId),
              eq(UploadSessionTable.status, "done"),
              inArray(UploadSessionTable.fileId, input.fileIds.slice(i, i + 500)),
            ),
          );
        for (const r of rows) if (r.fileId) own.add(r.fileId);
      }
      const others = input.fileIds.filter((id) => !own.has(id));
      const names = others.length
        ? await db
            .select({ id: FileTable.id, name: FileTable.name })
            .from(FileTable)
            .where(inArray(FileTable.id, others.slice(0, 500)))
        : [];
      const refused = names.map((f) => ({ id: f.id, name: f.name, reason: "You can only delete photos you added" }));
      const res = await serial(() => trashFiles([...own], userId));
      return { deleted: res.deleted, failed: [...refused, ...res.failed] };
    }),

  renameAlbum: adminProcedure
    .input(z.object({ albumId: z.string().uuid(), name: z.string().min(1).max(200) }))
    .mutation(({ input }) =>
      serial(async () => {
        try {
          return await renameFolder(input.albumId, input.name);
        } catch (e) {
          throw asBadRequest(e);
        }
      }),
    ),

  deleteAlbum: adminProcedure
    .input(z.object({ albumId: z.string().uuid() }))
    .mutation(({ ctx: { userId }, input }) =>
      serial(async () => {
        try {
          return await trashFolder(input.albumId, userId);
        } catch (e) {
          throw asBadRequest(e);
        }
      }),
    ),

  // null: go back to the automatic cover (first photo, then sub-albums).
  setAlbumCover: adminProcedure
    .input(z.object({ albumId: z.string().uuid(), fileId: z.string().uuid().nullable() }))
    .mutation(async ({ input }) => {
      try {
        return await setAlbumCover(input.albumId, input.fileId);
      } catch (e) {
        throw asBadRequest(e);
      }
    }),
});
