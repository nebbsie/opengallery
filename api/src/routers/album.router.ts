import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  FileTable,
  ImageMetadataTable,
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
          })
        ),
      })
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
        libs.map((l) => [l.id, l.userId])
      );
      const invalid = input.albums.filter(
        (a) => libOwnerById[a.libraryId] !== targetUserId
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
          }))
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
      })
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
            eq(LibraryTable.userId, input.userId)
          )
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
      db.select().from(AlbumTable).where(eq(AlbumTable.dir, dir)).limit(1)
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
        .where(eq(AlbumTable.libraryId, libraryId))
    ),

  getUsersAlbums: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const rows = await db
      .select({
        album: AlbumTable,
      })
      .from(AlbumTable)
      .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
      .where(and(eq(LibraryTable.userId, userId), isNull(AlbumTable.parentId)))
      .orderBy(desc(AlbumTable.createdAt));

    const albumIds = rows.map((r) => r.album.id);

    if (albumIds.length === 0)
      return [] as Array<
        (typeof rows)[number]["album"] & { items: number; cover: string | null }
      >;

    // Count items per album
    const itemsRes = await db.execute(
      sql<{
        album_id: string;
        items: number;
      }>`
        SELECT af.album_id, COUNT(*)::int AS items
        FROM ${AlbumFileTable} af
        WHERE af.album_id IN (${sql.join(albumIds, sql`, `)})
        GROUP BY af.album_id
      `
    );
    const itemsByAlbum = Object.fromEntries(
      itemsRes.rows.map((r) => [r["album_id"], Number(r["items"])])
    ) as Record<string, number>;

    // Compute cover per album: prefer explicit cover, else first image file id
    const coverRes = await db.execute(
      sql<{
        album_id: string;
        cover: string | null;
      }>`
        SELECT a.id AS album_id,
               COALESCE(
                 a.cover,
                 (
                   SELECT f.id
                   FROM ${AlbumFileTable} af
                   JOIN ${FileTable} f ON f.id = af.file_id
                   WHERE af.album_id = a.id AND f.type = 'image'
                   ORDER BY f.created_at ASC
                   LIMIT 1
                 )
               ) AS cover
        FROM ${AlbumTable} a
        WHERE a.id IN (${sql.join(albumIds, sql`, `)})
      `
    );
    const coverByAlbum = Object.fromEntries(
      coverRes.rows.map((r) => [
        r["album_id"],
        (r["cover"] as string | null) ?? null,
      ])
    ) as Record<string, string | null>;

    return rows.map((r) => ({
      ...r.album,
      items: itemsByAlbum[r.album.id] ?? 0,
      cover: coverByAlbum[r.album.id] ?? r.album.cover ?? null,
    }));
  }),

  // Fetch all albums for the current user, including child albums
  getAllUserAlbums: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

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

  // Fetch a single album by id, ensuring it belongs to the current user
  getAlbumById: privateProcedure
    .input(z.string())
    .query(async ({ ctx: { userId }, input: albumId }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

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
          albumCover: AlbumTable.cover,
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

      // ensure array of simple POJOs with camelCase keys
      const ancestors = lineage.map((l) => ({
        id: l["id"] as string,
        name: l["name"] as string,
        parentId: l["parent_id"] as string,
        dir: l["dir"] as string,
      }));

      // relative segments from filesystem view
      const rel = stripPrefix(normalize(albumRow.dir), rootPath);
      const relSegments = rel.split("/").filter(Boolean);

      // files - order consistently with asset view: coalesce(takenAt, createdAt) DESC
      const files = await db
        .select({ file: FileTable })
        .from(AlbumFileTable)
        .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
        .leftJoin(
          ImageMetadataTable,
          eq(ImageMetadataTable.fileId, FileTable.id)
        )
        .where(eq(AlbumFileTable.albumId, albumId))
        .orderBy(
          desc(
            sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`
          )
        );

      // child albums
      const children = await db
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
        .where(
          and(eq(AlbumTable.parentId, albumId), eq(LibraryTable.userId, userId))
        )
        .orderBy(desc(AlbumTable.createdAt));

      // Augment children with items count and computed cover
      const childIds = children.map((c) => c.id);
      let childrenWithMeta = children as Array<
        (typeof children)[number] & { items?: number }
      >;
      if (childIds.length > 0) {
        const childItemsRes = await db.execute(
          sql<{
            album_id: string;
            items: number;
          }>`
            SELECT af.album_id, COUNT(*)::int AS items
            FROM ${AlbumFileTable} af
            WHERE af.album_id IN (${sql.join(childIds, sql`, `)})
            GROUP BY af.album_id
          `
        );
        const childItemsMap = Object.fromEntries(
          childItemsRes.rows.map((r) => [r["album_id"], Number(r["items"])])
        ) as Record<string, number>;

        const childCoverRes = await db.execute(
          sql<{
            album_id: string;
            cover: string | null;
          }>`
            SELECT a.id AS album_id,
                   COALESCE(
                     a.cover,
                     (
                       SELECT f.id
                       FROM ${AlbumFileTable} af
                       JOIN ${FileTable} f ON f.id = af.file_id
                       WHERE af.album_id = a.id AND f.type = 'image'
                       ORDER BY f.created_at ASC
                       LIMIT 1
                     )
                   ) AS cover
            FROM ${AlbumTable} a
            WHERE a.id IN (${sql.join(childIds, sql`, `)})
          `
        );
        const childCoverMap = Object.fromEntries(
          childCoverRes.rows.map((r) => [
            r["album_id"],
            (r["cover"] as string | null) ?? null,
          ])
        ) as Record<string, string | null>;

        childrenWithMeta = children.map((c) => ({
          ...c,
          items: childItemsMap[c.id] ?? 0,
          cover: childCoverMap[c.id] ?? c.cover ?? null,
        }));
      }

      return {
        album: {
          id: albumRow.albumId,
          name: albumRow.name,
          dir: albumRow.dir,
          parentId: albumRow.parentId,
          libraryId: albumRow.libraryId,
          items: files.length,
        },
        files: files.map((r) => r.file),
        children: childrenWithMeta,
        tree: {
          rootPath, // absolute media root path
          encodedRoot, // base64url(rootPath) for /root/:encodedRoot
          relSegments, // ['nested','dir', ...]
          ancestors, // [{ id, parentId, name, dir }, ...] root->current
        },
      };
    }),

  // Remove empty albums under a directory (recursively) for a specified user (internal only)
  removeEmptyUnderDir: internalProcedure
    .input(z.object({ dir: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const { dir, userId } = input;

      // Fetch candidate albums under dir for this user, deepest-first
      const candidates = await db
        .select({ id: AlbumTable.id })
        .from(AlbumTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
        .where(
          and(
            eq(LibraryTable.userId, userId),
            or(
              eq(AlbumTable.dir, dir),
              sql`${AlbumTable.dir} LIKE ${dir + "/%"}`
            )
          )
        )
        .orderBy(desc(sql`length(${AlbumTable.dir})`));

      if (candidates.length === 0) return { removed: 0 } as const;

      let removed = 0;
      for (const { id } of candidates) {
        // Skip if album still has files linked
        const hasFiles = await db
          .select({ id: AlbumFileTable.id })
          .from(AlbumFileTable)
          .where(eq(AlbumFileTable.albumId, id))
          .limit(1);
        if (hasFiles.length > 0) continue;

        await db.delete(AlbumTable).where(eq(AlbumTable.id, id));
        removed++;
      }

      return { removed } as const;
    }),

  setParentByDir: internalProcedure
    .input(
      z.object({
        libraryId: z.string(),
        dir: z.string(),
        parentId: z.string().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      await db
        .update(AlbumTable)
        .set({ parentId: input.parentId })
        .where(
          and(
            eq(AlbumTable.libraryId, input.libraryId),
            eq(AlbumTable.dir, input.dir)
          )
        );
    }),
});
