import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { LibraryFileTable } from "../db/schema.js";

export const libraryFileRouter = router({
  create: privateProcedure
    .input(
      z.array(
        z.object({
          fileId: z.string(),
          libraryId: z.string(),
        })
      )
    )
    .mutation(({ ctx, input }) => db.insert(LibraryFileTable).values(input)),
});