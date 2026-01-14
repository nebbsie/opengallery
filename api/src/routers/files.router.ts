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
import { z } from "zod";
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
  VideoMetadataTable,
} from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

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
        })
      )
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
      db.select().from(FileTable).where(eq(FileTable.dir, input))
    ),

  removeFilesById: internalProcedure
    .input(z.array(z.string()))
    .mutation(async ({ input }) => {
      if (!input.length) return [];

      // Also delete any variants created for these files
      const variantRows = await db
        .select({ fileId: FileVariantTable.fileId })
        .from(FileVariantTable)
        .where(inArray(FileVariantTable.originalFileId, input));

      const variantFileIds = variantRows.map((r) => r.fileId);
      const idsToDelete = Array.from(new Set([...input, ...variantFileIds]));

      // Remove metadata and relations first to satisfy FKs
      await db
        .update(AlbumTable)
        .set({ cover: null })
        .where(inArray(AlbumTable.cover, idsToDelete));

      await db
        .delete(VideoMetadataTable)
        .where(inArray(VideoMetadataTable.fileId, idsToDelete));

      await db
        .delete(ImageMetadataTable)
        .where(inArray(ImageMetadataTable.fileId, idsToDelete));

      await db
        .delete(GeoLocationTable)
        .where(inArray(GeoLocationTable.fileId, idsToDelete));

      await db
        .delete(AlbumFileTable)
        .where(inArray(AlbumFileTable.fileId, idsToDelete));

      await db
        .delete(LibraryFileTable)
        .where(inArray(LibraryFileTable.fileId, idsToDelete));

      // Remove any file tasks
      await db
        .delete(FileTaskTable)
        .where(inArray(FileTaskTable.fileId, idsToDelete));

      await db
        .delete(FileVariantTable)
        .where(
          or(
            inArray(FileVariantTable.originalFileId, idsToDelete),
            inArray(FileVariantTable.fileId, idsToDelete)
          )
        );

      // Finally delete the files themselves (originals and variants)
      const result = await db
        .delete(FileTable)
        .where(inArray(FileTable.id, idsToDelete))
        .returning({ id: FileTable.id });

      return result;
    }),

  // Remove all files under a directory (recursively) for a specified user (internal only)
  removeFilesUnderDir: internalProcedure
    .input(z.object({ dir: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const { dir, userId } = input;

      // Gather all file IDs for this user where FileTable.dir is dir or a subdirectory of dir
      const rows = await db
        .select({ id: FileTable.id })
        .from(LibraryFileTable)
        .innerJoin(FileTable, eq(FileTable.id, LibraryFileTable.fileId))
        .innerJoin(
          LibraryTable,
          eq(LibraryTable.id, LibraryFileTable.libraryId)
        )
        .where(
          and(
            eq(LibraryTable.userId, userId),
            isNull(LibraryFileTable.deletedAt),
            or(eq(FileTable.dir, dir), sql`${FileTable.dir} LIKE ${dir + "/%"}`)
          )
        );

      const fileIds = rows.map((r) => r.id);
      if (fileIds.length === 0) return [] as { id: string }[];

      // Reuse the same deletion logic as removeFilesById
      // Also delete any variants created for these files
      const variantRows = await db
        .select({ fileId: FileVariantTable.fileId })
        .from(FileVariantTable)
        .where(inArray(FileVariantTable.originalFileId, fileIds));

      const variantFileIds = variantRows.map((r) => r.fileId);
      const idsToDelete = Array.from(new Set([...fileIds, ...variantFileIds]));

      await db
        .update(AlbumTable)
        .set({ cover: null })
        .where(inArray(AlbumTable.cover, idsToDelete));

      await db
        .delete(VideoMetadataTable)
        .where(inArray(VideoMetadataTable.fileId, idsToDelete));

      await db
        .delete(ImageMetadataTable)
        .where(inArray(ImageMetadataTable.fileId, idsToDelete));

      await db
        .delete(GeoLocationTable)
        .where(inArray(GeoLocationTable.fileId, idsToDelete));

      await db
        .delete(AlbumFileTable)
        .where(inArray(AlbumFileTable.fileId, idsToDelete));

      await db
        .delete(LibraryFileTable)
        .where(inArray(LibraryFileTable.fileId, idsToDelete));

      await db
        .delete(FileVariantTable)
        .where(
          or(
            inArray(FileVariantTable.originalFileId, idsToDelete),
            inArray(FileVariantTable.fileId, idsToDelete)
          )
        );

      const result = await db
        .delete(FileTable)
        .where(inArray(FileTable.id, fileIds))
        .returning({ id: FileTable.id });

      return result;
    }),

  getAllFiles: internalProcedure.query(() => db.select().from(FileTable)),

  viewFile: privateProcedure
    .input(
      z.object({
        fileId: z.string(),
        albumId: z.string().uuid().optional(),
        cameraMake: z.string().optional(),
        cameraModel: z.string().optional(),
      })
    )
    .query(async ({ input, ctx: { userId } }) => {
      const { fileId, albumId, cameraMake, cameraModel } = input;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

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

      // Ensure the user has this file in their library and it's not deleted
      const [link] = await db
        .select({ libraryFileId: LibraryFileTable.id })
        .from(LibraryFileTable)
        .innerJoin(
          LibraryTable,
          eq(LibraryTable.id, LibraryFileTable.libraryId)
        )
        .where(
          and(
            eq(LibraryFileTable.fileId, file.id),
            eq(LibraryTable.userId, userId),
            isNull(LibraryFileTable.deletedAt)
          )
        )
        .limit(1);

      if (!link) {
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
        if (albumRow.libraryUserId !== userId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const [membership] = await db
          .select({ id: AlbumFileTable.id })
          .from(AlbumFileTable)
          .where(
            and(
              eq(AlbumFileTable.albumId, albumId),
              eq(AlbumFileTable.fileId, file.id)
            )
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

      // Compute prev/next IDs using the same ordering, optionally scoped to an album or camera
      // Include both images and videos; do not filter by current file's type
      let orderedFileIds: { id: string }[];

      if (albumId) {
        orderedFileIds = await db
          .select({ id: FileTable.id })
          .from(AlbumFileTable)
          .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
          .leftJoin(
            ImageMetadataTable,
            eq(ImageMetadataTable.fileId, FileTable.id)
          )
          .where(and(eq(AlbumFileTable.albumId, albumId)))
          .orderBy(
            desc(
              sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`
            )
          );
      } else if (cameraMake && cameraModel) {
        orderedFileIds = await db
          .select({ id: FileTable.id })
          .from(ImageMetadataTable)
          .innerJoin(FileTable, eq(FileTable.id, ImageMetadataTable.fileId))
          .innerJoin(
            LibraryFileTable,
            eq(LibraryFileTable.fileId, FileTable.id)
          )
          .innerJoin(
            LibraryTable,
            eq(LibraryTable.id, LibraryFileTable.libraryId)
          )
          .where(
            and(
              eq(LibraryTable.userId, userId),
              isNull(LibraryFileTable.deletedAt),
              eq(ImageMetadataTable.cameraMake, cameraMake),
              eq(ImageMetadataTable.cameraModel, cameraModel),
              isNotNull(ImageMetadataTable.takenAt)
            )
          )
          .orderBy(desc(ImageMetadataTable.takenAt));
      } else {
        orderedFileIds = await db
          .select({ id: FileTable.id })
          .from(LibraryFileTable)
          .innerJoin(FileTable, eq(FileTable.id, LibraryFileTable.fileId))
          .innerJoin(
            LibraryTable,
            eq(LibraryTable.id, LibraryFileTable.libraryId)
          )
          .leftJoin(
            ImageMetadataTable,
            eq(ImageMetadataTable.fileId, FileTable.id)
          )
          .where(
            and(
              eq(LibraryTable.userId, userId),
              isNull(LibraryFileTable.deletedAt)
            )
          )
          .orderBy(
            desc(
              sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`
            )
          );
      }

      const ids = orderedFileIds.map((r) => r.id);
      const currentIndex = ids.indexOf(file.id);
      if (currentIndex === -1) {
        // Shouldn't happen due to access check, but guard anyway
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File not found in user's library.",
        });
      }

      const prevId = currentIndex > 0 ? ids[currentIndex - 1] : null;
      const nextId =
        currentIndex < ids.length - 1 ? ids[currentIndex + 1] : null;

      return {
        file,
        imageMetadata: imageMetadata ?? null,
        geoLocation: geoLocation ?? null,
        prevId,
        nextId,
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
            })
          )
          .min(1)
          .max(2),
      })
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
          })
          .onConflictDoNothing({
            target: [FileVariantTable.originalFileId, FileVariantTable.type],
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
          eq(FileVariantTable.fileId, file.id),
          inArray(FileVariantTable.type, ["thumbnail", "optimised"])
        )
      );

    const thumbnail = variants.find((v) => v.type === "thumbnail") ?? null;
    const optimized = variants.find((v) => v.type === "optimised") ?? null;

    return { raw: file, thumbnail, optimized };
  }),

  getUsersFiles: privateProcedure
    .input(
      z.object({
        kind: z.enum(["all", "video", "image"]).default("all"),
        limit: z.number().int().positive().max(200).default(60),
        cursor: z.string().uuid().nullable().optional(),
      })
    )
    .query(async ({ ctx: { userId }, input }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return getUsersFiles(userId, input);
    }),
});

const getUsersFiles = async (
  userId: string,
  params: {
    kind: "all" | "video" | "image";
    limit: number;
    cursor?: string | null | undefined;
  }
) => {
  const { kind, limit, cursor } = params;

  // If cursor provided, get the sort value of that record to paginate from
  let cursorCondition: ReturnType<typeof sql> | undefined;
  if (cursor) {
    // Get the sort timestamp for the cursor record (takenAt only)
    const [cursorRecord] = await db
      .select({
        sortTs: ImageMetadataTable.takenAt,
      })
      .from(FileTable)
      .innerJoin(
        ImageMetadataTable,
        eq(ImageMetadataTable.fileId, FileTable.id)
      )
      .where(eq(FileTable.id, cursor))
      .limit(1);

    if (cursorRecord?.sortTs) {
      cursorCondition = sql`${ImageMetadataTable.takenAt} < ${cursorRecord.sortTs}`;
    }
  }

  const rows = await db
    .select({
      file: FileTable,
      libraryId: LibraryTable.id,
      libraryFileId: LibraryFileTable.id,
      blurhash: ImageMetadataTable.blurhash,
    })
    .from(LibraryFileTable)
    .innerJoin(FileTable, eq(FileTable.id, LibraryFileTable.fileId))
    .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
    .innerJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
    .where(
      and(
        eq(LibraryTable.userId, userId),
        isNull(LibraryFileTable.deletedAt),
        // Only include files that have an actual takenAt date
        isNotNull(ImageMetadataTable.takenAt),
        ...(kind === "all" ? [] : [eq(FileTable.type, kind)]),
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
        ),
        // Cursor-based pagination: only get items older than cursor
        ...(cursorCondition ? [cursorCondition] : [])
      )
    )
    .orderBy(desc(ImageMetadataTable.takenAt))
    .limit(limit + 1);

  const data = rows.map((r) => ({
    ...r.file,
    libraryId: r.libraryId,
    libraryFileId: r.libraryFileId,
    blurhash: r.blurhash,
  }));

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
  return { items, nextCursor } as const;
};
