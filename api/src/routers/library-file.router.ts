import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTable, LibraryFileTable } from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { companionIdsIn } from "../utils/raw-pairing.js";

export const libraryFileRouter = router({
  create: internalProcedure
    .input(
      z.array(
        z.object({
          fileId: z.string(),
          libraryId: z.string(),
        })
      )
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      // A RAW companion stays out of the library (utils/raw-pairing.ts), and
      // a link that is already there is not added twice.
      const companions = companionIdsIn(input.map((i) => i.fileId));
      const existing = new Set(
        input.length
          ? (
              await db
                .select({ fileId: LibraryFileTable.fileId, libraryId: LibraryFileTable.libraryId })
                .from(LibraryFileTable)
                .where(inArray(LibraryFileTable.fileId, input.map((i) => i.fileId)))
            ).map((r) => `${r.fileId}|${r.libraryId}`)
          : [],
      );
      const rows = input.filter(
        (i) => !companions.has(i.fileId) && !existing.has(`${i.fileId}|${i.libraryId}`),
      );
      if (rows.length === 0) return [];
      return db
        .insert(LibraryFileTable)
        .values(
          rows.map((inp) => ({
            ...inp,
            userId,
          }))
        )
        .returning();
    }),

  getAllLibraryFiles: internalProcedure
    .input(z.string())
    .query(({ input: libraryId }) =>
      db
        .select({
          id: FileTable.id,
          dir: FileTable.dir,
          name: FileTable.name,
          type: FileTable.type,
          mime: FileTable.mime,
          size: FileTable.size,
          createdAt: FileTable.createdAt,
          updatedAt: FileTable.updatedAt,
        })
        .from(FileTable)
        .innerJoin(LibraryFileTable, eq(FileTable.id, LibraryFileTable.fileId))
        .where(eq(LibraryFileTable.libraryId, libraryId))
    ),

  removeLibraryFilesById: internalProcedure
    .input(z.array(z.string()))
    .mutation(({ input }) =>
      db.delete(LibraryFileTable).where(inArray(LibraryFileTable.id, input))
    ),
});
