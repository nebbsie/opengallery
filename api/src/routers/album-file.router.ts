import { db } from "../db/index.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { AlbumFileTable, FileTable } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { companionIdsIn } from "../utils/raw-pairing.js";

export const albumFileRouter = router({
  create: internalProcedure
    .input(
      z.array(
        z.object({
          albumId: z.string(),
          fileId: z.string(),
        }),
      ),
    )
    .mutation(async ({ input }) => {
      // A RAW companion is in no album (utils/raw-pairing.ts), and a link
      // that is already there is not added twice.
      const companions = companionIdsIn(input.map((i) => i.fileId));
      const existing = new Set(
        input.length
          ? (
              await db
                .select({ fileId: AlbumFileTable.fileId, albumId: AlbumFileTable.albumId })
                .from(AlbumFileTable)
                .where(inArray(AlbumFileTable.fileId, input.map((i) => i.fileId)))
            ).map((r) => `${r.fileId}|${r.albumId}`)
          : [],
      );
      const rows = input.filter(
        (i) => !companions.has(i.fileId) && !existing.has(`${i.fileId}|${i.albumId}`),
      );
      if (rows.length) await db.insert(AlbumFileTable).values(rows);
    }),

  getByAlbumIds: internalProcedure
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
