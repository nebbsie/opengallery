import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTable, LibraryFileTable, LibraryTable } from "../db/schema.js";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const filesRouter = router({
  create: internalProcedure
    .input(
      z.array(
        z.object({
          dir: z.string(),
          path: z.string(),
          name: z.string(),
          type: z.enum(["image", "video"]),
          mime: z.string(),
          size: z.number(),
          encoded: z.boolean(),
          fileCreatedAt: z.date(),
        }),
      ),
    )
    .mutation(({ input }) =>
      db.insert(FileTable).values(input).returning({ id: FileTable.id }),
    ),

  getFilesInDir: privateProcedure
    .input(z.string())
    .mutation(({ input }) =>
      db.select().from(FileTable).where(eq(FileTable.dir, input)),
    ),

  removeFilesById: internalProcedure
    .input(z.array(z.string()))
    .mutation(({ input }) =>
      db.delete(FileTable).where(inArray(FileTable.id, input)),
    ),

  getAllFiles: internalProcedure.query(() => db.select().from(FileTable)),

  // All files owned by the authenticated user (excludes soft-deleted links)
  getUsersFiles: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" }); // requires real user
    }

    const rows = await db
      .select({
        file: FileTable, // full file row
        libraryId: LibraryTable.id, // owning library
        libraryFileId: LibraryFileTable.id,
      })
      .from(LibraryFileTable)
      .innerJoin(FileTable, eq(FileTable.id, LibraryFileTable.fileId))
      .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
      .where(
        and(
          eq(LibraryTable.userId, userId),
          isNull(LibraryFileTable.deletedAt),
        ),
      )
      .orderBy(desc(FileTable.fileCreatedAt));

    // flatten to just file fields plus linkage ids
    return rows.map((r) => ({
      ...r.file,
      libraryId: r.libraryId,
      libraryFileId: r.libraryFileId,
    }));
  }),
});
