import { db } from "../db/index.js";
import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import {
  AlbumTable,
  FileTable,
  LibraryFileTable,
  LibraryTable,
} from "../db/schema.js";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { text, uuid } from "drizzle-orm/pg-core";

export const albumRouter = router({
  createMultiAlbums: privateProcedure
    .input(
      z.object({
        userId: z.string(), // required top-level for both internal and external
        albums: z.array(
          z.object({
            name: z.string(),
            libraryId: z.string(),
            dir: z.string(),
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
          dir: a.dir,
        })),
      );

      return { created: input.albums.length };
    }),

  create: privateProcedure
    .input(
      z.object({
        userId: z.string(), // required top-level for both internal and external
        album: z.object({
          name: z.string(),
          libraryId: z.string(),
          dir: z.string(),
        }),
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
      const [lib] = await db
        .select({ id: LibraryTable.id, userId: LibraryTable.userId })
        .from(LibraryTable)
        .where(
          and(
            eq(LibraryTable.id, input.album.libraryId),
            eq(LibraryTable.userId, input.userId),
          ),
        )
        .limit(1);

      if (!lib) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Album references a library not owned by the specified user",
        });
      }

      // Insert with userId from top-level
      await db.insert(AlbumTable).values({
        name: input.album.name,
        libraryId: input.album.libraryId,
        dir: input.album.dir,
      });
    }),

  get: privateProcedure.query(() => db.select().from(AlbumTable)),

  getAlbumByDir: privateProcedure
    .input(z.string())
    .query(({ input: dir }) =>
      db.select().from(AlbumTable).where(eq(AlbumTable.dir, dir)).limit(1),
    ),

  getAllAlbumsForLibrary: privateProcedure
    .input(z.string())
    .query(({ input: libraryId }) =>
      db
        .select({
          id: AlbumTable.id,
          name: AlbumTable.name,
          desc: AlbumTable.desc,
          cover: AlbumTable.cover,
          parentId: AlbumTable.parentId,
          libraryId: AlbumTable.libraryId,
          dir: AlbumTable.dir,
          createdAt: AlbumTable.createdAt,
          updatedAt: AlbumTable.updatedAt,
        })
        .from(AlbumTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
        .where(eq(AlbumTable.libraryId, libraryId)),
    ),

  getUsersAlbums: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

    const rows = await db
      .select({
        album: AlbumTable,
      })
      .from(AlbumTable)
      .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
      .where(eq(LibraryTable.userId, userId))
      .orderBy(desc(AlbumTable.createdAt));

    return rows.map((r) => ({
      ...r.album,
    }));
  }),
});
