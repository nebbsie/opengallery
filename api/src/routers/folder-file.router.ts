import { db } from "../db/index.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { FolderFileTable } from "../db/schema.js";
import { inArray } from "drizzle-orm";

export const folderFileRouter = router({
  create: privateProcedure
    .input(
      z.array(
        z.object({
          folderId: z.string(),
          fileId: z.string(),
        }),
      ),
    )
    .mutation(({ ctx: { userId }, input }) =>
      db.insert(FolderFileTable).values(input),
    ),

  getByFolderIds: privateProcedure
    .input(z.array(z.string()))
    .query(({ input: folderIds }) =>
      db
        .select()
        .from(FolderFileTable)
        .where(inArray(FolderFileTable.folderId, folderIds)),
    ),

  removeFolderFilesById: internalProcedure
    .input(z.array(z.string()))
    .mutation(({ input }) =>
      db.delete(FolderFileTable).where(inArray(FolderFileTable.id, input)),
    ),
});
