import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAccessScope } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { FileTable, UploadSessionTable } from "../db/schema.js";
import { adminProcedure, privateProcedure, router } from "../trpc.js";
import { renameFolder, setAlbumCover, trashFiles, trashFolder } from "../utils/media-edit.js";
import { rotateFiles, rotationPending } from "../utils/rotate.js";
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

// Of fileIds, the ones this user uploaded (a non-admin may change only those).
async function uploadedBy(userId: string, fileIds: string[]): Promise<Set<string>> {
  const own = new Set<string>();
  for (let i = 0; i < fileIds.length; i += 500) {
    const rows = await db
      .select({ fileId: UploadSessionTable.fileId })
      .from(UploadSessionTable)
      .where(
        and(
          eq(UploadSessionTable.userId, userId),
          eq(UploadSessionTable.status, "done"),
          inArray(UploadSessionTable.fileId, fileIds.slice(i, i + 500)),
        ),
      );
    for (const r of rows) if (r.fileId) own.add(r.fileId);
  }
  return own;
}

// Name and reason for the files a non-admin may not change.
async function refusedOthers(fileIds: string[], own: Set<string>, reason: string) {
  const others = fileIds.filter((id) => !own.has(id));
  const names = others.length
    ? await db
        .select({ id: FileTable.id, name: FileTable.name })
        .from(FileTable)
        .where(inArray(FileTable.id, others.slice(0, 500)))
    : [];
  return names.map((f) => ({ id: f.id, name: f.name, reason }));
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
      const own = await uploadedBy(userId, input.fileIds);
      const refused = await refusedOthers(input.fileIds, own, "You can only delete photos you added");
      const res = await serial(() => trashFiles([...own], userId));
      return { deleted: res.deleted, failed: [...refused, ...res.failed] };
    }),

  // Turn photos clockwise (90), counter-clockwise (-90) or upside down (180).
  // Admins any photo; other users the photos they uploaded.
  rotateFiles: privateProcedure
    .input(
      z.object({
        fileIds: z.array(z.string().uuid()).min(1).max(5000),
        degrees: z.union([z.literal(90), z.literal(-90), z.literal(180)]),
      }),
    )
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      if (scope.isAdmin) return serial(() => rotateFiles(input.fileIds, input.degrees));
      const own = await uploadedBy(userId, input.fileIds);
      const refused = await refusedOthers(input.fileIds, own, "You can only rotate photos you added");
      const res = await serial(() => rotateFiles([...own], input.degrees));
      return { rotated: res.rotated, failed: [...refused, ...res.failed], files: res.files };
    }),

  // Of these photos, the ones whose variants are still being made again after
  // a rotate. The web polls it, then fetches the new pixels.
  rotationPending: privateProcedure
    .input(z.object({ fileIds: z.array(z.string().uuid()).min(1).max(5000) }))
    .query(({ input }) => rotationPending(input.fileIds)),

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
