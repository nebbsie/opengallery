import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../trpc.js";
import { renameFolder, setAlbumCover, trashFiles, trashFolder } from "../utils/media-edit.js";
import { describeWriteError } from "../utils/media-trash.js";

// Library edits that change the media folder too (utils/media-edit.ts).
// Admin-only: they move and rename the originals on the drive.

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
  deleteFiles: adminProcedure
    .input(z.object({ fileIds: z.array(z.string().uuid()).min(1).max(5000) }))
    .mutation(({ ctx: { userId }, input }) => serial(() => trashFiles(input.fileIds, userId))),

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
