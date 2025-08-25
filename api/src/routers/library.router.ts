import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { LibraryTable } from "../db/schema.js";

export const libraryRouter = router({
  create: privateProcedure
    .mutation(({ ctx }) => db.insert(LibraryTable).values({userId: 'nEs49evY5imDVIaqxbYBeQkCAZkjkPQu'})),

  getDefaultLibraryId: privateProcedure
    .query(() => db.select({id: LibraryTable.id}).from(LibraryTable).orderBy(LibraryTable.createdAt).limit(1)),
});