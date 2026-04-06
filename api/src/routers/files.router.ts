import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { basename, extname } from "node:path";
import { z } from "zod";
import {
  buildFileAccessFilter,
  canUserViewFile,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
  GeoLocationTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
  MediaSettingsTable,
} from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { deleteFilesWithCascade } from "../utils/file-operations.js";

export const filesRouter = router({
  create: internalProcedure
    .input(
      z.array(
        z.object({
          dir: z.string(),
          name: z.string(),
          type: z.enum(["image", "video"]),
          mime: z.string(),
          size: z.number(),
          contentHash: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input }) => {
      const addedFiles = await db.insert(FileTable).values(input).returning();

      // Seed file tasks for downstream processing
      type FileTaskInsert = typeof FileTaskTable.$inferInsert;
      const taskRows: FileTaskInsert[] = [];
      for (const f of addedFiles) {
        if (f.type === "image") {
          taskRows.push({ fileId: f.id, type: "encode_thumbnail" });
          taskRows.push({ fileId: f.id, type: "encode_optimised" });
        } else {
          taskRows.push({ fileId: f.id, type: "video_poster" });
          taskRows.push({ fileId: f.id, type: "encode_optimised" });
        }
      }
      if (taskRows.length) {
        await db.insert(FileTaskTable).values(taskRows);
      }

      return addedFiles;
    }),

  getFilesInDir: privateProcedure
    .input(z.string())
    .mutation(({ input }) =>
      db.select().from(FileTable).where(eq(FileTable.dir, input)),
    ),

  removeFilesById: internalProcedure
    .input(z.array(z.string()))
    .mutation(async ({ input }) => {
      return deleteFilesWithCascade(input);
    }),

  // Remove all files under a directory (recursively) for a specified user (internal only)
  removeFilesUnderDir: internalProcedure
    .input(z.object({ dir: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const { dir, userId } = input;

      const rows = await db
        .select({ id: FileTable.id })
        .from(LibraryFileTable)
        .innerJoin(FileTable, eq(FileTable.id, LibraryFileTable.fileId))
        .innerJoin(
          LibraryTable,
          eq(LibraryTable.id, LibraryFileTable.libraryId),
        )
        .where(
          and(
            eq(LibraryTable.userId, userId),
            isNull(LibraryFileTable.deletedAt),
            or(
              eq(FileTable.dir, dir),
              sql`${FileTable.dir} LIKE ${dir + "/%"}`,
            ),
          ),
        );

      const fileIds = rows.map((r) => r.id);
      if (fileIds.length === 0) return [] as { id: string }[];

      return deleteFilesWithCascade(fileIds);
    }),

  getAllFiles: internalProcedure.query(() => db.select().from(FileTable)),

  viewFile: privateProcedure
    .input(
      z.object({
        fileId: z.string(),
        albumId: z.string().uuid().optional(),
        cameraMake: z.string().optional(),
        cameraModel: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx: { userId, session } }) => {
      const { fileId, albumId, cameraMake, cameraModel } = input;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const accessScope = await getAccessScope(userId, session);

      // Load the file and ensure it exists and is an image
      const [file] = await db
        .select()
        .from(FileTable)
        .where(eq(FileTable.id, fileId))
        .limit(1);

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `File not found: ${fileId}`,
        });
      }

      if (!(await canUserViewFile(userId, session, file.id))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this file.",
        });
      }

      // If albumId provided, ensure album belongs to user and file is in album
      if (albumId) {
        const [albumRow] = await db
          .select({ id: AlbumTable.id, libraryUserId: LibraryTable.userId })
          .from(AlbumTable)
          .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
          .where(eq(AlbumTable.id, albumId))
          .limit(1);

        if (!albumRow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Album not found",
          });
        }
        if (!accessScope.visibleAlbumIds.has(albumId)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const [membership] = await db
          .select({ id: AlbumFileTable.id })
          .from(AlbumFileTable)
          .where(
            and(
              eq(AlbumFileTable.albumId, albumId),
              eq(AlbumFileTable.fileId, file.id),
            ),
          )
          .limit(1);

        if (!membership) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Specified file is not part of the provided album",
          });
        }
      }

      // Load image metadata and geo location
      const [imageMetadata] = await db
        .select()
        .from(ImageMetadataTable)
        .where(eq(ImageMetadataTable.fileId, file.id))
        .limit(1);

      const [geoLocation] = await db
        .select()
        .from(GeoLocationTable)
        .where(eq(GeoLocationTable.fileId, file.id))
        .limit(1);

      // Compute prev/next IDs efficiently by fetching only adjacent items
      // Instead of loading ALL file IDs, we use the current file's sort value
      // to find the immediate prev/next items (O(1) queries instead of O(n))
      const currentSortValue = imageMetadata?.takenAt ?? file.createdAt;

      let prevId: string | null = null;
      let nextId: string | null = null;

      if (albumId) {
        // Album context: find prev (newer/left in visual order) and next (older/right in visual order) within album
        // Albums display items in DESC order (newest first), so left/right arrows navigate through that visual order
        const [prev] = await db
          .select({ id: FileTable.id })
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
              sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt}) > ${currentSortValue}`,
            ),
          )
          .orderBy(
            sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt}) ASC`,
          )
          .limit(1);

        const [next] = await db
          .select({ id: FileTable.id })
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
              sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt}) < ${currentSortValue}`,
            ),
          )
          .orderBy(
            desc(
              sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`,
            ),
          )
          .limit(1);

        prevId = prev?.id ?? null;
        nextId = next?.id ?? null;
      } else if (cameraMake && cameraModel) {
        // Camera context: find prev (newer/left in visual order) and next (older/right in visual order) within same camera
        // Camera files display in DESC order (newest first), so left/right arrows navigate through that visual order
        const [prev] = await db
          .select({ id: FileTable.id })
          .from(ImageMetadataTable)
          .innerJoin(FileTable, eq(FileTable.id, ImageMetadataTable.fileId))
          .where(
            and(
              buildFileAccessFilter(accessScope, FileTable.id),
              eq(ImageMetadataTable.cameraMake, cameraMake),
              eq(ImageMetadataTable.cameraModel, cameraModel),
              isNotNull(ImageMetadataTable.takenAt),
              sql`${ImageMetadataTable.takenAt} > ${currentSortValue}`,
            ),
          )
          .orderBy(sql`${ImageMetadataTable.takenAt} ASC`)
          .limit(1);

        const [next] = await db
          .select({ id: FileTable.id })
          .from(ImageMetadataTable)
          .innerJoin(FileTable, eq(FileTable.id, ImageMetadataTable.fileId))
          .where(
            and(
              buildFileAccessFilter(accessScope, FileTable.id),
              eq(ImageMetadataTable.cameraMake, cameraMake),
              eq(ImageMetadataTable.cameraModel, cameraModel),
              isNotNull(ImageMetadataTable.takenAt),
              sql`${ImageMetadataTable.takenAt} < ${currentSortValue}`,
            ),
          )
          .orderBy(desc(ImageMetadataTable.takenAt))
          .limit(1);

        prevId = prev?.id ?? null;
        nextId = next?.id ?? null;
      } else {
        // Global library context: find prev (newer/left in visual order) and next (older/right in visual order) in user's entire library
        // Library files display in DESC order (newest first), so left/right arrows navigate through that visual order
        const [prev] = await db
          .select({ id: FileTable.id })
          .from(FileTable)
          .leftJoin(
            ImageMetadataTable,
            eq(ImageMetadataTable.fileId, FileTable.id),
          )
          .where(
            and(
              buildFileAccessFilter(accessScope, FileTable.id),
              sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt}) > ${currentSortValue}`,
            ),
          )
          .orderBy(
            sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt}) ASC`,
          )
          .limit(1);

        const [next] = await db
          .select({ id: FileTable.id })
          .from(FileTable)
          .leftJoin(
            ImageMetadataTable,
            eq(ImageMetadataTable.fileId, FileTable.id),
          )
          .where(
            and(
              buildFileAccessFilter(accessScope, FileTable.id),
              sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt}) < ${currentSortValue}`,
            ),
          )
          .orderBy(
            desc(
              sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`,
            ),
          )
          .limit(1);

        prevId = prev?.id ?? null;
        nextId = next?.id ?? null;
      }

      const ownerLibraryIds = accessScope.ownedLibraryIds;

      return {
        file,
        imageMetadata: imageMetadata ?? null,
        geoLocation: geoLocation ?? null,
        prevId,
        nextId,
        canManageShares:
          accessScope.isAdmin ||
          (await db
            .select({ libraryId: LibraryFileTable.libraryId })
            .from(LibraryFileTable)
            .where(
              and(
                eq(LibraryFileTable.fileId, file.id),
                isNull(LibraryFileTable.deletedAt),
              ),
            )
            .limit(1)
            .then((rows) => ownerLibraryIds.has(rows[0]?.libraryId ?? ""))),
      };
    }),

  saveVariants: internalProcedure
    .input(
      z.object({
        originalFileId: z.string().uuid(),
        variants: z
          .array(
            z.object({
              type: z.enum(["thumbnail", "optimised"]),
              fileType: z.enum(["image", "video"]),
              dir: z.string(),
              name: z.string(), // e.g. `${base}__thumb.avif`
              mime: z.string(),
              size: z.number().int().nonnegative(),
              quality: z.number().int().min(1).max(100).optional(),
            }),
          )
          .min(1)
          .max(2),
      }),
    )
    .mutation(async ({ input }) => {
      const { originalFileId, variants } = input;

      const result: {
        originalFileId: string;
        thumbnail: null | { id: string; dir: string; name: string };
        optimised: null | { id: string; dir: string; name: string };
      } = { originalFileId, thumbnail: null, optimised: null };

      for (const v of variants) {
        const [res] = await db
          .insert(FileTable)
          .values({
            dir: v.dir,
            name: v.name,
            mime: v.mime,
            size: v.size,
            type: v.fileType,
          })
          .onConflictDoUpdate({
            target: [FileTable.dir, FileTable.name],
            set: {
              mime: v.mime,
              size: v.size,
              type: v.fileType,
            },
          })
          .returning({ id: FileTable.id });

        if (!res || !res.id) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to insert variant file",
          });
        }

        await db
          .insert(FileVariantTable)
          .values({
            originalFileId,
            fileId: res.id,
            type: v.type,
            quality: v.quality,
          })
          .onConflictDoUpdate({
            target: [FileVariantTable.originalFileId, FileVariantTable.type],
            set: {
              fileId: res.id,
              ...(v.quality !== undefined && { quality: v.quality }),
            },
          });

        result[v.type] = { id: res.id, dir: v.dir, name: v.name };
      }

      return result;
    }),

  getFileById: internalProcedure.input(z.string()).query(async ({ input }) => {
    const [file] = await db
      .select()
      .from(FileTable)
      .where(eq(FileTable.id, input))
      .limit(1);
    if (!file) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Failed to find file by id: ${input}`,
      });
    }

    const variants = await db
      .select()
      .from(FileVariantTable)
      .where(
        and(
          eq(FileVariantTable.originalFileId, file.id),
          inArray(FileVariantTable.type, ["thumbnail", "optimised"]),
        ),
      );

    const thumbnail = variants.find((v) => v.type === "thumbnail") ?? null;
    const optimized = variants.find((v) => v.type === "optimised") ?? null;

    return {
      raw: file,
      thumbnail: thumbnail
        ? {
            id: thumbnail.id,
            dir: file.dir,
            name: `${basename(file.name, extname(file.name))}__thumb.avif`,
            quality: thumbnail.quality,
          }
        : null,
      optimized: optimized
        ? {
            id: optimized.id,
            dir: file.dir,
            name: `${basename(file.name, extname(file.name))}__opt.avif`,
            quality: optimized.quality,
          }
        : null,
    };
  }),

  getUsersFiles: privateProcedure
    .input(
      z.object({
        kind: z.enum(["all", "video", "image"]).default("all"),
        limit: z.number().int().positive().max(500).default(60),
        cursor: z.string().nullable().optional(),
        seekCursor: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return getUsersFiles(userId, session, input);
    }),

  getTimeline: privateProcedure
    .input(
      z.object({
        kind: z.enum(["all", "video", "image"]).default("all"),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const [accessScope, hideUndated] = await Promise.all([
        getAccessScope(userId, session),
        getHideUndated(userId),
      ]);
      const sortExpr = sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`;

      const months = await db
        .select({
          year: sql<number>`cast(strftime('%Y', ${sortExpr}) as integer)`,
          month: sql<number>`cast(strftime('%m', ${sortExpr}) as integer)`,
          count: sql<number>`count(*)`,
        })
        .from(FileTable)
        .innerJoin(
          ImageMetadataTable,
          eq(ImageMetadataTable.fileId, FileTable.id),
        )
        .where(
          and(
            buildFileAccessFilter(accessScope, FileTable.id),
            ...(input.kind === "all" ? [] : [eq(FileTable.type, input.kind)]),
            ...(hideUndated ? [isNotNull(ImageMetadataTable.takenAt)] : []),
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
        .groupBy(
          sql`strftime('%Y', ${sortExpr})`,
          sql`strftime('%m', ${sortExpr})`,
        )
        .orderBy(
          desc(sql`cast(strftime('%Y', ${sortExpr}) as integer)`),
          desc(sql`cast(strftime('%m', ${sortExpr}) as integer)`),
        );

      const total = months.reduce((sum, m) => sum + m.count, 0);
      return { months, total };
    }),
});

const getHideUndated = async (userId: string): Promise<boolean> => {
  const [settings] = await db
    .select({ hideUndated: MediaSettingsTable.hideUndated })
    .from(MediaSettingsTable)
    .where(eq(MediaSettingsTable.userId, userId))
    .limit(1);
  return settings?.hideUndated ?? false;
};

const getUsersFiles = async (
  userId: string,
  session: { user?: { type?: "user" | "admin" } } | null,
  params: {
    kind: "all" | "video" | "image";
    limit: number;
    cursor?: string | null | undefined;
    seekCursor?: string | null | undefined;
  },
) => {
  const { kind, limit, cursor, seekCursor } = params;
  const [accessScope, hideUndated] = await Promise.all([
    getAccessScope(userId, session),
    getHideUndated(userId),
  ]);
  const sortExpr = sql<string>`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`;

  // seekCursor is used when jumping to a specific date (e.g. clicking a year/month on the timeline).
  // It acts as the cursor when no regular pagination cursor is provided.
  const effectiveCursor = cursor ?? seekCursor;
  const cursorCondition = effectiveCursor
    ? sql`${sortExpr} < ${effectiveCursor}`
    : undefined;

  const rows = await db
    .select({
      file: FileTable,
      blurhash: ImageMetadataTable.blurhash,
      takenAt: ImageMetadataTable.takenAt,
      sortAt: sortExpr,
    })
    .from(FileTable)
    .innerJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
    .where(
      and(
        buildFileAccessFilter(accessScope, FileTable.id),
        ...(kind === "all" ? [] : [eq(FileTable.type, kind)]),
        // When hideUndated is on, only show files with a takenAt date
        ...(hideUndated ? [isNotNull(ImageMetadataTable.takenAt)] : []),
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
        // Cursor-based pagination: only get items older than cursor timestamp
        ...(cursorCondition ? [cursorCondition] : []),
      ),
    )
    .orderBy(desc(sortExpr))
    .limit(limit + 1);

  const data = rows.map((r) => ({
    ...r.file,
    blurhash: r.blurhash,
    takenAt: r.takenAt,
    sortAt: r.sortAt,
  }));

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  const nextCursor = hasMore ? (items[items.length - 1]?.sortAt ?? null) : null;
  return { items, nextCursor } as const;
};
