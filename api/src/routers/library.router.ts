import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { LibraryTable } from "../db/schema.js";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

export const libraryRouter = router({
  getDefaultLibraryIdForUser: internalProcedure
    .input(z.string())
    .query(async ({ input: userId }) => {
      const [library] = await db
        .select({ id: LibraryTable.id })
        .from(LibraryTable)
        .where(eq(LibraryTable.userId, userId))
        .orderBy(LibraryTable.createdAt)
        .limit(1);

      if (!library) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get library",
        });
      }

      return library.id;
    }),
});
