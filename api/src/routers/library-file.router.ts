import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  FileTable,
  FileTypeEnum,
  LibraryFileTable,
} from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { integer, text } from "drizzle-orm/pg-core";

export const libraryFileRouter = router({
  create: privateProcedure
    .input(
      z.array(
        z.object({
          fileId: z.string(),
          libraryId: z.string(),
        }),
      ),
    )
    .mutation(({ ctx: { userId }, input }) =>
      db
        .insert(LibraryFileTable)
        .values(
          input.map((inp) => ({
            ...inp,
            userId,
          })),
        )
        .returning(),
    ),

  getAllLibraryFiles: privateProcedure
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
        .where(eq(LibraryFileTable.libraryId, libraryId)),
    ),

  removeLibraryFilesById: internalProcedure
    .input(z.array(z.string()))
    .mutation(({ input }) =>
      db.delete(LibraryFileTable).where(inArray(LibraryFileTable.id, input)),
    ),
});
