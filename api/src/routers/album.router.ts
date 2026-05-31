import { TRPCError } from "@trpc/server";
import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildFileAccessFilter,
  canUserManageSharedItem,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { fileSortExpr, galleryOrderBy } from "../db/file-sort.js";
import {
  AlbumFileTable,
  AlbumTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
  ImageMetadataTable,
  LibraryTable,
  MediaPathTable,
  SharedItemTable,
  UserTable,
} from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

// Albums are hierarchical via parentId (no closure table). These helpers let item
// counts and cover photos roll up through sub-albums, so a folder-style album with
// no direct items still reflects what's nested inside it.

// parent -> direct children, restricted to the accessible album set so we never
// recurse into (or count) albums the user can't see.
function buildChildrenMap(
  albums: Array<{ id: string; parentId: string | null }>,
  allowed: Set<string>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const a of albums) {
    if (!allowed.has(a.id) || !a.parentId || !allowed.has(a.parentId)) continue;
    const list = map.get(a.parentId) ?? [];
    list.push(a.id);
    map.set(a.parentId, list);
  }
  return map;
}

// Every album id in the subtree rooted at albumId (including itself), breadth-first.
// The visited guard makes a stray parentId cycle safe rather than an infinite loop.
function collectSubtree(
  albumId: string,
  childrenByParent: Map<string, string[]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [albumId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return out;
}

// Distinct viewable files across an album's whole subtree, given a per-album set
// of that album's own direct file ids. Distinct so a file sitting in both a parent
// and a child album isn't double-counted.
function recursiveItemCount(
  albumId: string,
  directFilesByAlbum: Map<string, Set<string>>,
  childrenByParent: Map<string, string[]>,
): number {
  const seen = new Set<string>();
  for (const id of collectSubtree(albumId, childrenByParent)) {
    const files = directFilesByAlbum.get(id);
    if (files) for (const f of files) seen.add(f);
  }
  return seen.size;
}

// Cover for an album: its own first direct image, else the first image found by
// walking descendants breadth-first (the album's own photos win, then the nearest
// sub-album's), else null.
function resolveRecursiveCover(
  albumId: string,
  firstImageByAlbum: Map<string, string>,
  childrenByParent: Map<string, string[]>,
): string | null {
  const seen = new Set<string>();
  const queue = [albumId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const img = firstImageByAlbum.get(id);
    if (img) return img;
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return null;
}

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

  getUsersAlbums: privateProcedure.query(
    async ({ ctx: { userId, session } }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const accessScope = await getAccessScope(userId, session);
      const accessibleAlbumIds = [...accessScope.visibleAlbumIds];

      if (accessibleAlbumIds.length === 0) {
        return [] as Array<
          typeof AlbumTable.$inferSelect & {
            items: number;
            cover: string | null;
            pendingTasks: number;
            canManageShares: boolean;
          }
        >;
      }

      const rows = await db
        .select({
          album: AlbumTable,
        })
        .from(AlbumTable)
        .where(inArray(AlbumTable.id, accessibleAlbumIds))
        .orderBy(desc(AlbumTable.createdAt));

      const accessibleSet = accessScope.visibleAlbumIds;
      const rootRows = rows.filter(
        (row) => !row.album.parentId || !accessibleSet.has(row.album.parentId),
      );

      const albumIds = rootRows.map((r) => r.album.id);

      if (albumIds.length === 0)
        return [] as Array<
          (typeof rows)[number]["album"] & {
            items: number;
            cover: string | null;
            pendingTasks: number;
            canManageShares: boolean;
          }
        >;

      // Build the accessible album tree so counts and covers roll up through
      // sub-albums (a container album with no direct items still reflects what's
      // nested inside it). `rows` holds every accessible album with its parentId.
      const childrenByParent = buildChildrenMap(
        rows.map((r) => r.album),
        accessScope.visibleAlbumIds,
      );

      // Every album id in each root's subtree, so a single scan covers them all.
      const subtreeIds = new Set<string>();
      for (const rootId of albumIds) {
        for (const id of collectSubtree(rootId, childrenByParent)) {
          subtreeIds.add(id);
        }
      }
      const subtreeIdList = [...subtreeIds];

      const hasThumbnail = exists(
        db
          .select()
          .from(FileVariantTable)
          .where(
            and(
              eq(FileVariantTable.originalFileId, FileTable.id),
              eq(FileVariantTable.type, "thumbnail"),
            ),
          ),
      );
      const hasOptimised = exists(
        db
          .select()
          .from(FileVariantTable)
          .where(
            and(
              eq(FileVariantTable.originalFileId, FileTable.id),
              eq(FileVariantTable.type, "optimised"),
            ),
          ),
      );

      // Direct (viewable) files per album, summed distinct-per-root below.
      const itemRows = await db
        .select({
          albumId: AlbumFileTable.albumId,
          fileId: AlbumFileTable.fileId,
        })
        .from(AlbumFileTable)
        .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
        .where(
          and(
            inArray(AlbumFileTable.albumId, subtreeIdList),
            buildFileAccessFilter(accessScope, FileTable.id),
            hasThumbnail,
            hasOptimised,
          ),
        );
      const directFilesByAlbum = new Map<string, Set<string>>();
      for (const r of itemRows) {
        let set = directFilesByAlbum.get(r.albumId);
        if (!set) {
          set = new Set();
          directFilesByAlbum.set(r.albumId, set);
        }
        set.add(r.fileId);
      }
      const itemsByAlbum: Record<string, number> = {};
      for (const rootId of albumIds) {
        itemsByAlbum[rootId] = recursiveItemCount(
          rootId,
          directFilesByAlbum,
          childrenByParent,
        );
      }

      // First direct image per album, for the cover fallback that walks the
      // subtree when an album has no explicit cover and no direct photo.
      const coverRows = await db
        .select({
          albumId: AlbumFileTable.albumId,
          fileId: sql<string>`MIN(${FileTable.id})`,
        })
        .from(AlbumFileTable)
        .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
        .where(
          and(
            inArray(AlbumFileTable.albumId, subtreeIdList),
            buildFileAccessFilter(accessScope, FileTable.id),
            eq(FileTable.type, "image"),
            hasThumbnail,
          ),
        )
        .groupBy(AlbumFileTable.albumId);
      const firstImageByAlbum = new Map<string, string>();
      for (const r of coverRows) if (r.fileId) firstImageByAlbum.set(r.albumId, r.fileId);

      // Pending encode tasks, also rolled up distinct-per-root across the subtree.
      const pendingRows = await db
        .select({
          albumId: AlbumFileTable.albumId,
          fileId: AlbumFileTable.fileId,
        })
        .from(AlbumFileTable)
        .innerJoin(
          FileTaskTable,
          eq(FileTaskTable.fileId, AlbumFileTable.fileId),
        )
        .where(
          and(
            inArray(AlbumFileTable.albumId, subtreeIdList),
            inArray(FileTaskTable.status, ["pending", "in_progress", "failed"]),
            sql`${FileTaskTable.attempts} < 3`,
          ),
        );
      const pendingFilesByAlbum = new Map<string, Set<string>>();
      for (const r of pendingRows) {
        let set = pendingFilesByAlbum.get(r.albumId);
        if (!set) {
          set = new Set();
          pendingFilesByAlbum.set(r.albumId, set);
        }
        set.add(r.fileId);
      }
      const pendingByAlbum: Record<string, number> = {};
      for (const rootId of albumIds) {
        pendingByAlbum[rootId] = recursiveItemCount(
          rootId,
          pendingFilesByAlbum,
          childrenByParent,
        );
      }

      return rootRows.map((r) => ({
        ...r.album,
        items: itemsByAlbum[r.album.id] ?? 0,
        cover:
          r.album.cover ??
          resolveRecursiveCover(r.album.id, firstImageByAlbum, childrenByParent),
        pendingTasks: pendingByAlbum[r.album.id] ?? 0,
        canManageShares:
          accessScope.isAdmin ||
          accessScope.ownedLibraryIds.has(r.album.libraryId),
      }));
    },
  ),

  // Fetch all albums for the current user, including child albums
  getAllUserAlbums: privateProcedure.query(
    async ({ ctx: { userId, session } }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const accessScope = await getAccessScope(userId, session);
      const accessibleAlbumIds = [...accessScope.visibleAlbumIds];

      if (accessibleAlbumIds.length === 0) {
        return [] as Array<typeof AlbumTable.$inferSelect>;
      }

      const rows = await db
        .select({
          album: AlbumTable,
        })
        .from(AlbumTable)
        .where(inArray(AlbumTable.id, accessibleAlbumIds))
        .orderBy(desc(AlbumTable.createdAt));

      return rows.map((r) => ({
        ...r.album,
      }));
    },
  ),

  // Fetch a single album by id, ensuring it belongs to the current user
  getAlbumById: privateProcedure
    .input(z.string())
    .query(async ({ ctx: { userId, session }, input: albumId }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const accessScope = await getAccessScope(userId, session);
      if (!accessScope.visibleAlbumIds.has(albumId)) {
        throw new TRPCError({ code: "FORBIDDEN" });
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

      return row.album;
    }),

  // Fetch files for an album, ensuring access by current user
  getAlbumInfo: privateProcedure
    .input(z.string())
    .query(async ({ ctx: { userId, session }, input: albumId }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const accessScope = await getAccessScope(userId, session);
      if (!accessScope.visibleAlbumIds.has(albumId)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

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

      // best matching user media root (longest prefix of dir)
      const mediaPaths = await db
        .select({ path: MediaPathTable.path })
        .from(MediaPathTable)
        .where(eq(MediaPathTable.userId, albumRow.libraryUserId));

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
      // Fetch all albums for this library to build the ancestor chain in memory (avoids N+1)
      const allLibraryAlbums = await db
        .select({
          id: AlbumTable.id,
          parentId: AlbumTable.parentId,
          name: AlbumTable.name,
          dir: AlbumTable.dir,
        })
        .from(AlbumTable)
        .where(eq(AlbumTable.libraryId, albumRow.libraryId));

      const albumMap = new Map(allLibraryAlbums.map((a) => [a.id, a]));

      const ancestors: Array<{
        id: string;
        name: string;
        parentId: string | null;
        dir: string;
      }> = [];
      let currentId: string | null = albumId;
      while (currentId) {
        const album = albumMap.get(currentId);
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

      // files - order matches the asset view's prev/next navigation
      const files = await db
        .select({ file: FileTable, blurhash: ImageMetadataTable.blurhash })
        .from(AlbumFileTable)
        .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
        .leftJoin(
          ImageMetadataTable,
          eq(ImageMetadataTable.fileId, FileTable.id),
        )
        .where(
          and(
            eq(AlbumFileTable.albumId, albumId),
            buildFileAccessFilter(accessScope, FileTable.id),
            // Only include files that have BOTH thumbnail and optimised variants
            exists(
              db
                .select()
                .from(FileVariantTable)
                .where(
                  and(
                    eq(FileVariantTable.originalFileId, FileTable.id),
                    eq(FileVariantTable.type, "thumbnail"),
                  ),
                ),
            ),
            exists(
              db
                .select()
                .from(FileVariantTable)
                .where(
                  and(
                    eq(FileVariantTable.originalFileId, FileTable.id),
                    eq(FileVariantTable.type, "optimised"),
                  ),
                ),
            ),
          ),
        )
        .orderBy(...galleryOrderBy(fileSortExpr));

      // Accessible album subtree rooted at this album, so the album's own count
      // and each child's count/cover roll up through nested sub-albums. The
      // current album's subtree already contains every child's subtree, so one
      // scan over it feeds all the rollups below.
      const childrenByParent = buildChildrenMap(
        allLibraryAlbums,
        accessScope.visibleAlbumIds,
      );
      const subtreeIdList = collectSubtree(albumId, childrenByParent);

      const hasThumbnail = exists(
        db
          .select()
          .from(FileVariantTable)
          .where(
            and(
              eq(FileVariantTable.originalFileId, FileTable.id),
              eq(FileVariantTable.type, "thumbnail"),
            ),
          ),
      );
      const hasOptimised = exists(
        db
          .select()
          .from(FileVariantTable)
          .where(
            and(
              eq(FileVariantTable.originalFileId, FileTable.id),
              eq(FileVariantTable.type, "optimised"),
            ),
          ),
      );

      const subtreeItemRows = await db
        .select({
          albumId: AlbumFileTable.albumId,
          fileId: AlbumFileTable.fileId,
        })
        .from(AlbumFileTable)
        .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
        .where(
          and(
            inArray(AlbumFileTable.albumId, subtreeIdList),
            buildFileAccessFilter(accessScope, FileTable.id),
            hasThumbnail,
            hasOptimised,
          ),
        );
      const directFilesByAlbum = new Map<string, Set<string>>();
      for (const r of subtreeItemRows) {
        let set = directFilesByAlbum.get(r.albumId);
        if (!set) {
          set = new Set();
          directFilesByAlbum.set(r.albumId, set);
        }
        set.add(r.fileId);
      }

      const subtreeCoverRows = await db
        .select({
          albumId: AlbumFileTable.albumId,
          fileId: sql<string>`MIN(${FileTable.id})`,
        })
        .from(AlbumFileTable)
        .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
        .where(
          and(
            inArray(AlbumFileTable.albumId, subtreeIdList),
            buildFileAccessFilter(accessScope, FileTable.id),
            eq(FileTable.type, "image"),
            hasThumbnail,
          ),
        )
        .groupBy(AlbumFileTable.albumId);
      const firstImageByAlbum = new Map<string, string>();
      for (const r of subtreeCoverRows) if (r.fileId) firstImageByAlbum.set(r.albumId, r.fileId);

      // Recursive item count for this album (distinct files across its subtree).
      const recursiveAlbumItems = recursiveItemCount(
        albumId,
        directFilesByAlbum,
        childrenByParent,
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
        .where(eq(AlbumTable.parentId, albumId))
        .orderBy(desc(AlbumTable.createdAt));

      const accessibleChildren = children.filter((child) =>
        accessScope.visibleAlbumIds.has(child.id),
      );

      // Each child's count/cover rolls up through its own sub-albums, reusing the
      // single subtree scan above (explicit cover still wins when one is set).
      const childrenWithMeta = accessibleChildren.map((c) => ({
        ...c,
        items: recursiveItemCount(c.id, directFilesByAlbum, childrenByParent),
        cover:
          c.cover ??
          resolveRecursiveCover(c.id, firstImageByAlbum, childrenByParent),
        canManageShares:
          accessScope.isAdmin || accessScope.ownedLibraryIds.has(c.libraryId),
      }));

      // Count pending tasks for this album (files with non-succeeded encode tasks)
      const pendingTasksRes = await db
        .select({
          pendingCount: sql<number>`COUNT(DISTINCT ${FileTaskTable.fileId})`,
        })
        .from(AlbumFileTable)
        .innerJoin(
          FileTaskTable,
          eq(FileTaskTable.fileId, AlbumFileTable.fileId),
        )
        .where(
          and(
            eq(AlbumFileTable.albumId, albumId),
            inArray(FileTaskTable.status, ["pending", "in_progress", "failed"]),
            sql`${FileTaskTable.attempts} < 3`,
          ),
        );
      const pendingTasks = Number(pendingTasksRes[0]?.pendingCount ?? 0);

      return {
        album: {
          id: albumRow.albumId,
          name: albumRow.name,
          dir: albumRow.dir,
          parentId: albumRow.parentId,
          libraryId: albumRow.libraryId,
          items: recursiveAlbumItems,
          pendingTasks,
          canManageShares:
            accessScope.isAdmin ||
            accessScope.ownedLibraryIds.has(albumRow.libraryId),
        },
        files: files.map((r) => ({ ...r.file, blurhash: r.blurhash })),
        children: childrenWithMeta,
        tree: {
          rootPath, // absolute media root path
          encodedRoot, // base64url(rootPath) for /root/:encodedRoot
          relSegments, // ['nested','dir', ...]
          ancestors, // [{ id, parentId, name, dir }, ...] root->current
        },
      };
    }),

  getShares: privateProcedure
    .input(
      z.object({
        sourceType: z.enum(["album", "file"]),
        sourceId: z.string(),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const canManage = await canUserManageSharedItem(
        userId,
        session,
        input.sourceType,
        input.sourceId,
      );

      if (!canManage) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const [users, shares] = await Promise.all([
        db
          .select({
            id: UserTable.id,
            name: UserTable.name,
            email: UserTable.email,
            type: UserTable.type,
          })
          .from(UserTable),
        db
          .select({ userId: SharedItemTable.sharedToUserId })
          .from(SharedItemTable)
          .where(
            and(
              eq(SharedItemTable.sourceType, input.sourceType),
              eq(SharedItemTable.sourceId, input.sourceId),
              eq(SharedItemTable.shareType, "user"),
              eq(SharedItemTable.accessLevel, "view"),
            ),
          ),
      ]);

      const selectedUserIds = shares
        .map((row) => row.userId)
        .filter((value): value is string => !!value);

      return {
        users: users.filter(
          (candidate) => candidate.id !== userId && candidate.type !== "admin",
        ),
        selectedUserIds,
      };
    }),

  updateShares: privateProcedure
    .input(
      z.object({
        sourceType: z.enum(["album", "file"]),
        sourceId: z.string(),
        userIds: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const canManage = await canUserManageSharedItem(
        userId,
        session,
        input.sourceType,
        input.sourceId,
      );

      if (!canManage) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const distinctUserIds = Array.from(new Set(input.userIds));

      if (distinctUserIds.length > 0) {
        const existingUsers = await db
          .select({ id: UserTable.id, type: UserTable.type })
          .from(UserTable)
          .where(inArray(UserTable.id, distinctUserIds));

        const validUsers = existingUsers.filter(
          (candidate) => candidate.type !== "admin",
        );
        if (validUsers.length !== distinctUserIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "One or more users are invalid",
          });
        }
      }

      await db
        .delete(SharedItemTable)
        .where(
          and(
            eq(SharedItemTable.sourceType, input.sourceType),
            eq(SharedItemTable.sourceId, input.sourceId),
            eq(SharedItemTable.shareType, "user"),
          ),
        );

      if (distinctUserIds.length > 0) {
        await db.insert(SharedItemTable).values(
          distinctUserIds.map((sharedToUserId) => ({
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            shareType: "user" as const,
            accessLevel: "view" as const,
            sharedToUserId,
          })),
        );
      }

      return { sharedUserIds: distinctUserIds };
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
              sql`${AlbumTable.dir} LIKE ${dir + "/%"}`,
            ),
          ),
        )
        .orderBy(desc(sql`length(${AlbumTable.dir})`));

      if (candidates.length === 0) return { removed: 0 } as const;

      const candidateIds = candidates.map((c) => c.id);

      // Batch query: find which albums have files (to exclude from deletion)
      const albumsWithFiles = await db
        .select({ albumId: AlbumFileTable.albumId })
        .from(AlbumFileTable)
        .where(inArray(AlbumFileTable.albumId, candidateIds))
        .groupBy(AlbumFileTable.albumId);

      const albumsWithFilesSet = new Set(albumsWithFiles.map((r) => r.albumId));

      // Filter to only empty albums (those not in the set)
      const emptyAlbumIds = candidateIds.filter(
        (id) => !albumsWithFilesSet.has(id),
      );

      if (emptyAlbumIds.length === 0) return { removed: 0 } as const;

      // Batch delete all empty albums
      await db.delete(AlbumTable).where(inArray(AlbumTable.id, emptyAlbumIds));

      return { removed: emptyAlbumIds.length } as const;
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
