import { db } from "../db/index.js";
import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { AlbumTable, LibraryTable } from "../db/schema.js";
import { TRPCError } from "@trpc/server";
import { inArray } from "drizzle-orm";

export const albumRouter = router({
  create: privateProcedure
    .input(
      z.object({
        userId: z.string(), // required top-level for both internal and external
        albums: z.array(
          z.object({
            name: z.string(),
            libraryId: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx: { userId: ctxUserId, isInternal }, input }) => {
      const targetUserId = input.userId;

      // External must match authenticated user
      if (!isInternal && targetUserId !== ctxUserId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot create albums for another user",
        });
      }

      // Validate libraries belong to targetUserId
      const libIds = Array.from(new Set(input.albums.map((a) => a.libraryId)));
      const libs = await db
        .select({ id: LibraryTable.id, userId: LibraryTable.userId })
        .from(LibraryTable)
        .where(inArray(LibraryTable.id, libIds));

      const libOwnerById = Object.fromEntries(
        libs.map((l) => [l.id, l.userId]),
      );
      const invalid = input.albums.filter(
        (a) => libOwnerById[a.libraryId] !== targetUserId,
      );
      if (invalid.length > 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "One or more albums reference a library not owned by the specified user",
        });
      }

      // Insert with userId from top-level
      await db.insert(AlbumTable).values(
        input.albums.map((a) => ({
          name: a.name,
          libraryId: a.libraryId,
          userId: targetUserId,
        })),
      );

      return { created: input.albums.length };
    }),

  get: privateProcedure.query(() => db.select().from(AlbumTable)),
});
