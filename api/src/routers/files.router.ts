import { TRPCError } from "@trpc/server";
import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  FileTable,
  FileVariantTable,
  GeoLocationTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
  VideoMetadataTable,
} from "../db/schema.js";
import { TasksQueue } from "../redis.js";
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
        })
      )
    )
    .mutation(async ({ input }) => {
      const addedFiles = await db.insert(FileTable).values(input).returning();

      type Message = {
        name: "encode";
        data: {
          fileId: string;
        };
      };

      const tasks: Message[] = addedFiles.map((f) => ({
        name: "encode",
        data: { fileId: f.id },
      }));

      await TasksQueue.addBulk(tasks);

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

      return db.transaction(async (tx) => {
        // Also delete any variants created for these files
        const variantRows = await tx
          .select({ fileId: FileVariantTable.fileId })
          .from(FileVariantTable)
          .where(inArray(FileVariantTable.originalFileId, input));

        const variantFileIds = variantRows.map((r) => r.fileId);
        const idsToDelete = Array.from(new Set([...input, ...variantFileIds]));

        // Remove metadata and relations first to satisfy FKs
        await tx
          .update(AlbumTable)
          .set({ cover: null })
          .where(inArray(AlbumTable.cover, idsToDelete));

        await tx
          .delete(VideoMetadataTable)
          .where(inArray(VideoMetadataTable.fileId, idsToDelete));

        await tx
          .delete(ImageMetadataTable)
          .where(inArray(ImageMetadataTable.fileId, idsToDelete));

        await tx
          .delete(GeoLocationTable)
          .where(inArray(GeoLocationTable.fileId, idsToDelete));

        await tx
          .delete(AlbumFileTable)
          .where(inArray(AlbumFileTable.fileId, idsToDelete));

        await tx
          .delete(LibraryFileTable)
          .where(inArray(LibraryFileTable.fileId, idsToDelete));

        await tx
          .delete(FileVariantTable)
          .where(
            or(
              inArray(FileVariantTable.originalFileId, idsToDelete),
              inArray(FileVariantTable.fileId, idsToDelete)
            )
          );

        // Finally delete the files themselves (originals and variants)
        return tx
          .delete(FileTable)
          .where(inArray(FileTable.id, idsToDelete))
          .returning({ id: FileTable.id });
      });
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
      return db.transaction(async (tx) => {
        // Also delete any variants created for these files
        const variantRows = await tx
          .select({ fileId: FileVariantTable.fileId })
          .from(FileVariantTable)
          .where(inArray(FileVariantTable.originalFileId, fileIds));

        const variantFileIds = variantRows.map((r) => r.fileId);
        const idsToDelete = Array.from(
          new Set([...fileIds, ...variantFileIds])
        );

        await tx
          .update(AlbumTable)
          .set({ cover: null })
          .where(inArray(AlbumTable.cover, idsToDelete));

        await tx
          .delete(VideoMetadataTable)
          .where(inArray(VideoMetadataTable.fileId, idsToDelete));

        await tx
          .delete(ImageMetadataTable)
          .where(inArray(ImageMetadataTable.fileId, idsToDelete));

        await tx
          .delete(GeoLocationTable)
          .where(inArray(GeoLocationTable.fileId, idsToDelete));

        await tx
          .delete(AlbumFileTable)
          .where(inArray(AlbumFileTable.fileId, idsToDelete));

        await tx
          .delete(LibraryFileTable)
          .where(inArray(LibraryFileTable.fileId, idsToDelete));

        await tx
          .delete(FileVariantTable)
          .where(
            or(
              inArray(FileVariantTable.originalFileId, idsToDelete),
              inArray(FileVariantTable.fileId, idsToDelete)
            )
          );

        return tx
          .delete(FileTable)
          .where(inArray(FileTable.id, idsToDelete))
          .returning({ id: FileTable.id });
      });
    }),

  getAllFiles: internalProcedure.query(() => db.select().from(FileTable)),

  viewFile: privateProcedure
    .input(
      z.object({
        fileId: z.string(),
        albumId: z.string().uuid().optional(),
      })
    )
    .query(async ({ input, ctx: { userId } }) => {
      const { fileId, albumId } = input;
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

      // Compute prev/next IDs using the same ordering, optionally scoped to an album
      // Include both images and videos; do not filter by current file's type
      const orderedFileIds = albumId
        ? await db
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
            )
        : await db
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

      return db.transaction(async (tx) => {
        const result: {
          originalFileId: string;
          thumbnail: null | { id: string; dir: string; name: string };
          optimised: null | { id: string; dir: string; name: string };
        } = { originalFileId, thumbnail: null, optimised: null };

        for (const v of variants) {
          const [res] = await tx
            .insert(FileTable)
            .values({
              dir: v.dir,
              name: v.name,
              mime: v.mime,
              size: v.size,
              type: v.fileType,
            })
            .returning({ id: FileTable.id });

          if (!res || !res.id) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to insert variant file",
            });
          }

          await tx.insert(FileVariantTable).values({
            originalFileId,
            fileId: res.id,
            type: v.type,
          });

          result[v.type] = { id: res.id, dir: v.dir, name: v.name };
        }

        return result;
      });
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
    .input(z.enum(["all", "video", "image"]))
    .query(async ({ ctx: { userId }, input }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return getUsersFiles(userId, input);
    }),
});

const getUsersFiles = async (
  userId: string,
  filter: "all" | "video" | "image"
) => {
  const rows = await db
    .select({
      file: FileTable,
      libraryId: LibraryTable.id,
      libraryFileId: LibraryFileTable.id,
    })
    .from(LibraryFileTable)
    .innerJoin(FileTable, eq(FileTable.id, LibraryFileTable.fileId))
    .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
    .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
    .where(
      and(
        eq(LibraryTable.userId, userId),
        isNull(LibraryFileTable.deletedAt),
        ...(filter === "all" ? [] : [eq(FileTable.type, filter)]),
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
      desc(sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`)
    );

  return rows.map((r) => ({
    ...r.file,
    libraryId: r.libraryId,
    libraryFileId: r.libraryFileId,
  }));
};
