import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  FolderFileTable,
  FolderTable,
  FileTable,
  LibraryTable,
  MediaPathTable,
} from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

export const folderRouter = router({
  createMultiFolders: privateProcedure
    .input(
      z.object({
        userId: z.string(), // required top-level for both internal and external
        folders: z.array(
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
          message: "Cannot create folders for another user",
        });
      }

      // Validate libraries belong to targetUserId
      const libIds = Array.from(new Set(input.folders.map((a) => a.libraryId)));
      const libs = await db
        .select({ id: LibraryTable.id, userId: LibraryTable.userId })
        .from(LibraryTable)
        .where(inArray(LibraryTable.id, libIds));

      const libOwnerById = Object.fromEntries(
        libs.map((l) => [l.id, l.userId]),
      );
      const invalid = input.folders.filter(
        (a) => libOwnerById[a.libraryId] !== targetUserId,
      );
      if (invalid.length > 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "One or more folders reference a library not owned by the specified user",
        });
      }

      // Insert with userId from top-level, avoid duplicates by (libraryId, dir)
      await db
        .insert(FolderTable)
        .values(
          input.folders.map((a) => ({
            name: a.name,
            libraryId: a.libraryId,
            userId: targetUserId,
            dir: a.dir,
          })),
        )
        .onConflictDoNothing({
          target: [FolderTable.libraryId, FolderTable.dir],
        });

      return { created: input.folders.length };
    }),

  create: privateProcedure
    .input(
      z.object({
        userId: z.string(), // required top-level for both internal and external
        folder: z.object({
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
          message: "Cannot create folders for another user",
        });
      }

      // Validate libraries belong to targetUserId
      const [lib] = await db
        .select({ id: LibraryTable.id, userId: LibraryTable.userId })
        .from(LibraryTable)
        .where(
          and(
            eq(LibraryTable.id, input.folder.libraryId),
            eq(LibraryTable.userId, input.userId),
          ),
        )
        .limit(1);

      if (!lib) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Folder references a library not owned by the specified user",
        });
      }

      // Insert with userId from top-level, upsert to set parentId if missing
      await db
        .insert(FolderTable)
        .values({
          name: input.folder.name,
          libraryId: input.folder.libraryId,
          dir: input.folder.dir,
          parentId: input.folder.parentId,
        })
        .onConflictDoUpdate({
          target: [FolderTable.libraryId, FolderTable.dir],
          set: { parentId: input.folder.parentId },
          where: isNull(FolderTable.parentId),
        });
    }),

  get: privateProcedure.query(() => db.select().from(FolderTable)),

  getFolderByDir: privateProcedure
    .input(z.string())
    .query(({ input: dir }) =>
      db.select().from(FolderTable).where(eq(FolderTable.dir, dir)).limit(1),
    ),

  getAllFoldersForLibrary: privateProcedure
    .input(z.string())
    .query(({ input: libraryId }) =>
      db
        .select({
          id: FolderTable.id,
          name: FolderTable.name,
          desc: FolderTable.desc,
          cover: FolderTable.cover,
          parentId: FolderTable.parentId,
          libraryId: FolderTable.libraryId,
          dir: FolderTable.dir,
          createdAt: FolderTable.createdAt,
          updatedAt: FolderTable.updatedAt,
        })
        .from(FolderTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, FolderTable.libraryId))
        .where(eq(FolderTable.libraryId, libraryId)),
    ),

  getUsersFolders: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const rows = await db
      .select({
        folder: FolderTable,
      })
      .from(FolderTable)
      .innerJoin(LibraryTable, eq(LibraryTable.id, FolderTable.libraryId))
      .where(and(eq(LibraryTable.userId, userId), isNull(FolderTable.parentId)))
      .orderBy(desc(FolderTable.createdAt));

    const folderIds = rows.map((r) => r.folder.id);

    if (folderIds.length === 0)
      return [] as Array<
        (typeof rows)[number]["folder"] & {
          items: number;
          cover: string | null;
        }
      >;

    // Count items per folder
    const itemsRes = await db.execute(
      sql<{
        folder_id: string;
        items: number;
      }>`
        SELECT ff.album_id, COUNT(*)::int AS items
        FROM ${FolderFileTable} ff
        WHERE ff.album_id IN (${sql.join(folderIds, sql`, `)})
        GROUP BY ff.album_id
      `,
    );
    const itemsByFolder = Object.fromEntries(
      itemsRes.rows.map((r) => [r["folder_id"], Number(r["items"])]),
    ) as Record<string, number>;

    // Compute cover per folder: prefer explicit cover, else first image file id
    const coverRes = await db.execute(
      sql<{
        folder_id: string;
        cover: string | null;
      }>`
        SELECT f.id AS folder_id,
               COALESCE(
                 f.cover,
                 (
                   SELECT f.id
                   FROM ${FolderFileTable} ff
                   JOIN ${FileTable} f ON f.id = ff.file_id
                   WHERE ff.album_id = f.id AND f.type = 'image'
                   ORDER BY f.created_at ASC
                   LIMIT 1
                 )
               ) AS cover
        FROM ${FolderTable} f
        WHERE f.id IN (${sql.join(folderIds, sql`, `)})
      `,
    );
    const coverByFolder = Object.fromEntries(
      coverRes.rows.map((r) => [
        r["folder_id"],
        (r["cover"] as string | null) ?? null,
      ]),
    ) as Record<string, string | null>;

    return rows.map((r) => ({
      ...r.folder,
      items: itemsByFolder[r.folder.id] ?? 0,
      cover: coverByFolder[r.folder.id] ?? r.folder.cover ?? null,
    }));
  }),

  // Fetch all folders for the current user, including child folders
  getAllUserFolders: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const rows = await db
      .select({
        folder: FolderTable,
      })
      .from(FolderTable)
      .innerJoin(LibraryTable, eq(LibraryTable.id, FolderTable.libraryId))
      .where(eq(LibraryTable.userId, userId))
      .orderBy(desc(FolderTable.createdAt));

    return rows.map((r) => ({
      ...r.folder,
    }));
  }),

  // Fetch a single folder by id, ensuring it belongs to the current user
  getFolderById: privateProcedure
    .input(z.string())
    .query(async ({ ctx: { userId }, input: folderId }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const [row] = await db
        .select({ folder: FolderTable, libraryUserId: LibraryTable.userId })
        .from(FolderTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, FolderTable.libraryId))
        .where(eq(FolderTable.id, folderId))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
      }

      if (row.libraryUserId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return row.folder;
    }),

  // Fetch files for a folder, ensuring access by current user
  getFolderInfo: privateProcedure
    .input(z.string())
    .query(async ({ ctx: { userId }, input: folderId }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const normalize = (p: string) => p.replace(/\\/g, "/");
      const stripPrefix = (full: string, prefix: string) =>
        full.startsWith(prefix)
          ? full.slice(prefix.length).replace(/^\/+/, "")
          : full;

      const b64url = (s: string) => Buffer.from(s).toString("base64url");

      // folder + owning user
      const rows = await db
        .select({
          folderId: FolderTable.id,
          name: FolderTable.name,
          dir: FolderTable.dir,
          parentId: FolderTable.parentId,
          libraryId: FolderTable.libraryId,
          folderCover: FolderTable.cover,
          libraryUserId: LibraryTable.userId,
        })
        .from(FolderTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, FolderTable.libraryId))
        .where(eq(FolderTable.id, folderId))
        .limit(1);

      const folderRow = rows[0];
      if (!folderRow)
        throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
      if (folderRow.libraryUserId !== userId)
        throw new TRPCError({ code: "FORBIDDEN" });

      // best matching user media root (longest prefix of dir)
      const rootQ = sql<{ path: string }>`
      SELECT mp.path
      FROM ${MediaPathTable} mp
      WHERE mp.user_id = ${userId}
        AND ${folderRow.dir} LIKE mp.path || '%'
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
        FROM ${FolderTable} a
        WHERE a.id = ${folderId}
        UNION ALL
        SELECT p.id, p.parent_id, p.name, p.dir
        FROM ${FolderTable} p
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
      const rel = stripPrefix(normalize(folderRow.dir), rootPath);
      const relSegments = rel.split("/").filter(Boolean);

      // files
      const files = await db
        .select({ file: FileTable })
        .from(FolderFileTable)
        .innerJoin(FileTable, eq(FileTable.id, FolderFileTable.fileId))
        .where(eq(FolderFileTable.folderId, folderId))
        .orderBy(desc(FileTable.createdAt));

      // child folders
      const children = await db
        .select({
          id: FolderTable.id,
          name: FolderTable.name,
          desc: FolderTable.desc,
          cover: FolderTable.cover,
          parentId: FolderTable.parentId,
          libraryId: FolderTable.libraryId,
          dir: FolderTable.dir,
          createdAt: FolderTable.createdAt,
          updatedAt: FolderTable.updatedAt,
        })
        .from(FolderTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, FolderTable.libraryId))
        .where(
          and(
            eq(FolderTable.parentId, folderId),
            eq(LibraryTable.userId, userId),
          ),
        )
        .orderBy(desc(FolderTable.createdAt));

      // Augment children with items count and computed cover
      const childIds = children.map((c) => c.id);
      let childrenWithMeta = children as Array<
        (typeof children)[number] & { items?: number }
      >;
      if (childIds.length > 0) {
        const childItemsRes = await db.execute(
          sql<{
            folder_id: string;
            items: number;
          }>`
            SELECT af.folder_id, COUNT(*)::int AS items
            FROM ${FolderFileTable} af
            WHERE af.folder_id IN (${sql.join(childIds, sql`, `)})
            GROUP BY af.folder_id
          `,
        );
        const childItemsMap = Object.fromEntries(
          childItemsRes.rows.map((r) => [r["folder_id"], Number(r["items"])]),
        ) as Record<string, number>;

        const childCoverRes = await db.execute(
          sql<{
            folder_id: string;
            cover: string | null;
          }>`
            SELECT a.id AS folder_id,
                   COALESCE(
                     a.cover,
                     (
                       SELECT f.id
                       FROM ${FolderFileTable} af
                       JOIN ${FileTable} f ON f.id = af.file_id
                       WHERE af.folder_id = a.id AND f.type = 'image'
                       ORDER BY f.created_at ASC
                       LIMIT 1
                     )
                   ) AS cover
            FROM ${FolderTable} a
            WHERE a.id IN (${sql.join(childIds, sql`, `)})
          `,
        );
        const childCoverMap = Object.fromEntries(
          childCoverRes.rows.map((r) => [
            r["folder_id"],
            (r["cover"] as string | null) ?? null,
          ]),
        ) as Record<string, string | null>;

        childrenWithMeta = children.map((c) => ({
          ...c,
          items: childItemsMap[c.id] ?? 0,
          cover: childCoverMap[c.id] ?? c.cover ?? null,
        }));
      }

      return {
        folder: {
          id: folderRow.folderId,
          name: folderRow.name,
          dir: folderRow.dir,
          parentId: folderRow.parentId,
          libraryId: folderRow.libraryId,
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
        .update(FolderTable)
        .set({ parentId: input.parentId })
        .where(
          and(
            eq(FolderTable.libraryId, input.libraryId),
            eq(FolderTable.dir, input.dir),
          ),
        );
    }),
});
