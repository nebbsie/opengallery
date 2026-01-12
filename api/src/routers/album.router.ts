import { TRPCError } from "@trpc/server";
import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
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
    const itemsRes = await db
      .select({
        albumId: AlbumFileTable.albumId,
        items: sql<number>`COUNT(*)`,
      })
      .from(AlbumFileTable)
      .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
      .where(
        and(
          inArray(AlbumFileTable.albumId, albumIds),
          exists(
            db
              .select()
              .from(FileVariantTable)
              .where(
                and(
                  eq(FileVariantTable.originalFileId, FileTable.id),
                  eq(FileVariantTable.type, "thumbnail")
                )
              )
          ),
          exists(
            db
              .select()
              .from(FileVariantTable)
              .where(
                and(
                  eq(FileVariantTable.originalFileId, FileTable.id),
                  eq(FileVariantTable.type, "optimised")
                )
              )
          )
        )
      )
      .groupBy(AlbumFileTable.albumId);
    const itemsByAlbum = Object.fromEntries(
      itemsRes.map((r) => [r.albumId, Number(r.items)])
    ) as Record<string, number>;

    // Compute cover per album: prefer explicit cover, else first image file id with thumbnail ready
    const albumsWithCovers = await db
      .select({ id: AlbumTable.id, cover: AlbumTable.cover })
      .from(AlbumTable)
      .where(inArray(AlbumTable.id, albumIds));

    const coverByAlbum: Record<string, string | null> = {};
    for (const album of albumsWithCovers) {
      if (album.cover) {
        coverByAlbum[album.id] = album.cover;
      } else {
        // Find first image file with thumbnail
        const [firstImage] = await db
          .select({ fileId: FileTable.id })
          .from(AlbumFileTable)
          .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
          .where(
            and(
              eq(AlbumFileTable.albumId, album.id),
              eq(FileTable.type, "image"),
              exists(
                db
                  .select()
                  .from(FileVariantTable)
                  .where(
                    and(
                      eq(FileVariantTable.originalFileId, FileTable.id),
                      eq(FileVariantTable.type, "thumbnail")
                    )
                  )
              )
            )
          )
          .orderBy(FileTable.createdAt)
          .limit(1);
        coverByAlbum[album.id] = firstImage?.fileId ?? null;
      }
    }

    // Count pending tasks per album (files with non-succeeded encode tasks)
    const pendingTasksRes = await db
      .select({
        albumId: AlbumFileTable.albumId,
        pendingCount: sql<number>`COUNT(DISTINCT ${FileTaskTable.fileId})`,
      })
      .from(AlbumFileTable)
      .innerJoin(FileTaskTable, eq(FileTaskTable.fileId, AlbumFileTable.fileId))
      .where(
        and(
          inArray(AlbumFileTable.albumId, albumIds),
          inArray(FileTaskTable.status, ["pending", "in_progress", "failed"]),
          sql`${FileTaskTable.attempts} < 3`
        )
      )
      .groupBy(AlbumFileTable.albumId);
    const pendingByAlbum = Object.fromEntries(
      pendingTasksRes.map((r) => [r.albumId, Number(r.pendingCount)])
    ) as Record<string, number>;

    return rows.map((r) => ({
      ...r.album,
      items: itemsByAlbum[r.album.id] ?? 0,
      cover: coverByAlbum[r.album.id] ?? r.album.cover ?? null,
      pendingTasks: pendingByAlbum[r.album.id] ?? 0,
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
      const mediaPaths = await db
        .select({ path: MediaPathTable.path })
        .from(MediaPathTable)
        .where(eq(MediaPathTable.userId, userId));

      // Find longest matching prefix
      let rootPath = "";
      for (const mp of mediaPaths) {
        const normalizedMp = normalize(mp.path);
        if (
          normalize(albumRow.dir).startsWith(normalizedMp) &&
          normalizedMp.length > rootPath.length
        ) {
          rootPath = normalizedMp;
        }
      }
      const encodedRoot = rootPath ? b64url(rootPath) : "";

      // lineage: root->...->current (ancestors incl. current)
      // Build lineage by walking up the parent chain
      const ancestors: Array<{
        id: string;
        name: string;
        parentId: string | null;
        dir: string;
      }> = [];
      let currentId: string | null = albumId;
      while (currentId) {
        const [album] = await db
          .select({
            id: AlbumTable.id,
            parentId: AlbumTable.parentId,
            name: AlbumTable.name,
            dir: AlbumTable.dir,
          })
          .from(AlbumTable)
          .where(eq(AlbumTable.id, currentId))
          .limit(1);
        if (!album) break;
        ancestors.unshift({
          id: album.id,
          name: album.name,
          parentId: album.parentId,
          dir: album.dir,
        });
        currentId = album.parentId;
      }

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
        .where(
          and(
            eq(AlbumFileTable.albumId, albumId),
            // Only include files that have BOTH thumbnail and optimised variants
            exists(
              db
                .select()
                .from(FileVariantTable)
                .where(
                  and(
                    eq(FileVariantTable.originalFileId, FileTable.id),
                    eq(FileVariantTable.type, "thumbnail")
                  )
                )
            ),
            exists(
              db
                .select()
                .from(FileVariantTable)
                .where(
                  and(
                    eq(FileVariantTable.originalFileId, FileTable.id),
                    eq(FileVariantTable.type, "optimised")
                  )
                )
            )
          )
        )
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
        const childItemsRes = await db
          .select({
            albumId: AlbumFileTable.albumId,
            items: sql<number>`COUNT(*)`,
          })
          .from(AlbumFileTable)
          .where(inArray(AlbumFileTable.albumId, childIds))
          .groupBy(AlbumFileTable.albumId);
        const childItemsMap = Object.fromEntries(
          childItemsRes.map((r) => [r.albumId, Number(r.items)])
        ) as Record<string, number>;

        // Compute covers for children
        const childCoverMap: Record<string, string | null> = {};
        for (const child of children) {
          if (child.cover) {
            childCoverMap[child.id] = child.cover;
          } else {
            const [firstImage] = await db
              .select({ fileId: FileTable.id })
              .from(AlbumFileTable)
              .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
              .where(
                and(
                  eq(AlbumFileTable.albumId, child.id),
                  eq(FileTable.type, "image"),
                  exists(
                    db
                      .select()
                      .from(FileVariantTable)
                      .where(
                        and(
                          eq(FileVariantTable.originalFileId, FileTable.id),
                          eq(FileVariantTable.type, "thumbnail")
                        )
                      )
                  )
                )
              )
              .orderBy(FileTable.createdAt)
              .limit(1);
            childCoverMap[child.id] = firstImage?.fileId ?? null;
          }
        }

        childrenWithMeta = children.map((c) => ({
          ...c,
          items: childItemsMap[c.id] ?? 0,
          cover: childCoverMap[c.id] ?? c.cover ?? null,
        }));
      }

      // Count pending tasks for this album (files with non-succeeded encode tasks)
      const pendingTasksRes = await db
        .select({
          pendingCount: sql<number>`COUNT(DISTINCT ${FileTaskTable.fileId})`,
        })
        .from(AlbumFileTable)
        .innerJoin(
          FileTaskTable,
          eq(FileTaskTable.fileId, AlbumFileTable.fileId)
        )
        .where(
          and(
            eq(AlbumFileTable.albumId, albumId),
            inArray(FileTaskTable.status, ["pending", "in_progress", "failed"]),
            sql`${FileTaskTable.attempts} < 3`
          )
        );
      const pendingTasks = Number(pendingTasksRes[0]?.pendingCount ?? 0);

      return {
        album: {
          id: albumRow.albumId,
          name: albumRow.name,
          dir: albumRow.dir,
          parentId: albumRow.parentId,
          libraryId: albumRow.libraryId,
          items: files.length,
          pendingTasks,
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
