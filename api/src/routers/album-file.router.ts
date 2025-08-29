import { db } from "../db/index.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { AlbumFileTable, FileTable } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";

export const albumFileRouter = router({
  create: privateProcedure
    .input(
      z.array(
        z.object({
          albumId: z.string(),
          fileId: z.string(),
        }),
      ),
    )
    .mutation(({ ctx: { userId }, input }) =>
      db.insert(AlbumFileTable).values(input),
    ),

  getByAlbumIds: privateProcedure
    .input(z.array(z.string()))
    .query(({ input: albumIds }) =>
      db
        .select()
        .from(AlbumFileTable)
        .where(inArray(AlbumFileTable.albumId, albumIds)),
    ),

  removeAlbumFilesById: internalProcedure
    .input(z.array(z.string()))
    .mutation(({ input }) =>
      db.delete(AlbumFileTable).where(inArray(AlbumFileTable.id, input)),
    ),
});
