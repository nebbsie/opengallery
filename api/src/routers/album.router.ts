import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  FileTable,
  LibraryTable,
  MediaPathTable,
} from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

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

      // Insert with userId from top-level, avoid duplicates by (libraryId, dir)
      await db
        .insert(AlbumTable)
        .values(
          input.albums.map((a) => ({
            name: a.name,
            libraryId: a.libraryId,
            userId: targetUserId,
            dir: a.dir,
          })),
        )
        .onConflictDoNothing({
          target: [AlbumTable.libraryId, AlbumTable.dir],
        });

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
          parentId: z.string().nullable(),
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

      // Insert with userId from top-level, upsert to set parentId if missing
      await db
        .insert(AlbumTable)
        .values({
          name: input.album.name,
          libraryId: input.album.libraryId,
          dir: input.album.dir,
          parentId: input.album.parentId,
        })
        .onConflictDoUpdate({
          target: [AlbumTable.libraryId, AlbumTable.dir],
          set: { parentId: input.album.parentId },
          where: isNull(AlbumTable.parentId),
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
      .where(and(eq(LibraryTable.userId, userId), isNull(AlbumTable.parentId)))
      .orderBy(desc(AlbumTable.createdAt));

    console.log(rows);

    return rows.map((r) => ({
      ...r.album,
    }));
  }),

  // Fetch a single album by id, ensuring it belongs to the current user
  getAlbumById: privateProcedure
    .input(z.string())
    .query(async ({ ctx: { userId }, input: albumId }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const [row] = await db
        .select({ album: AlbumTable, libraryUserId: LibraryTable.userId })
        .from(AlbumTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
        .where(eq(AlbumTable.id, albumId))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Album not found" });
      }

      if (row.libraryUserId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return row.album;
    }),

  // Fetch files for an album, ensuring access by current user
  getAlbumInfo: privateProcedure
    .input(z.string())
    .query(async ({ ctx: { userId }, input: albumId }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const normalize = (p: string) => p.replace(/\\/g, "/");
      const stripPrefix = (full: string, prefix: string) =>
        full.startsWith(prefix)
          ? full.slice(prefix.length).replace(/^\/+/, "")
          : full;

      const b64url = (s: string) => Buffer.from(s).toString("base64url");

      // album + owning user
      const rows = await db
        .select({
          albumId: AlbumTable.id,
          name: AlbumTable.name,
          dir: AlbumTable.dir,
          parentId: AlbumTable.parentId,
          libraryId: AlbumTable.libraryId,
          libraryUserId: LibraryTable.userId,
        })
        .from(AlbumTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
        .where(eq(AlbumTable.id, albumId))
        .limit(1);

      const albumRow = rows[0];
      if (!albumRow)
        throw new TRPCError({ code: "NOT_FOUND", message: "Album not found" });
      if (albumRow.libraryUserId !== userId)
        throw new TRPCError({ code: "FORBIDDEN" });

      // best matching user media root (longest prefix of dir)
      const rootQ = sql<{ path: string }>`
      SELECT mp.path
      FROM ${MediaPathTable} mp
      WHERE mp.user_id = ${userId}
        AND ${albumRow.dir} LIKE mp.path || '%'
      ORDER BY length(mp.path) DESC
      LIMIT 1
    `;
      const rootMatch = await db.execute<{ path: string }>(rootQ);
      const rootPath = normalize(rootMatch.rows[0]?.path ?? "");
      const encodedRoot = rootPath ? b64url(rootPath) : "";

      // lineage: root->...->current (ancestors incl. current)
      const lineageQ = sql<{
        id: string;
        parent_id: string | null;
        name: string;
        dir: string;
      }>`
      WITH RECURSIVE chain AS (
        SELECT a.id, a.parent_id, a.name, a.dir
        FROM ${AlbumTable} a
        WHERE a.id = ${albumId}
        UNION ALL
        SELECT p.id, p.parent_id, p.name, p.dir
        FROM ${AlbumTable} p
        JOIN chain c ON p.id = c.parent_id
      )
      SELECT * FROM chain
    `;
      const lineageRes = await db.execute(lineageQ);
      const lineage = lineageRes.rows.reverse(); // root -> current

      // relative segments from filesystem view
      const rel = stripPrefix(normalize(albumRow.dir), rootPath);
      const relSegments = rel.split("/").filter(Boolean);

      // files
      const files = await db
        .select({ file: FileTable })
        .from(AlbumFileTable)
        .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
        .where(eq(AlbumFileTable.albumId, albumId))
        .orderBy(desc(FileTable.createdAt));

      return {
        album: {
          id: albumRow.albumId,
          name: albumRow.name,
          dir: albumRow.dir,
          parentId: albumRow.parentId,
          libraryId: albumRow.libraryId,
        },
        files: files.map((r) => r.file),
        tree: {
          rootPath, // absolute media root path
          encodedRoot, // base64url(rootPath) for /root/:encodedRoot
          relSegments, // ['nested','dir', ...]
          ancestors: lineage, // [{ id, parent_id, name, dir }, ...] root->current
        },
      };
    }),

  setParentByDir: internalProcedure
    .input(
      z.object({
        libraryId: z.string(),
        dir: z.string(),
        parentId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(AlbumTable)
        .set({ parentId: input.parentId })
        .where(
          and(
            eq(AlbumTable.libraryId, input.libraryId),
            eq(AlbumTable.dir, input.dir),
          ),
        );
    }),
});
