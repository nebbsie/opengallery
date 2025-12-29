import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  FileTable,
  FileVariantTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
} from "../db/schema.js";
import { privateProcedure, router } from "../trpc.js";

export const cameraRouter = router({
  getAllCameras: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // Get all unique camera make/model combinations with file counts
    const cameras = await db
      .select({
        cameraMake: ImageMetadataTable.cameraMake,
        cameraModel: ImageMetadataTable.cameraModel,
        count: sql<number>`count(distinct ${FileTable.id})::int`,
      })
      .from(ImageMetadataTable)
      .innerJoin(FileTable, eq(FileTable.id, ImageMetadataTable.fileId))
      .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
      .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
      .where(
        and(
          eq(LibraryTable.userId, userId),
          isNull(LibraryFileTable.deletedAt),
          sql`${ImageMetadataTable.cameraMake} IS NOT NULL`,
          sql`${ImageMetadataTable.cameraModel} IS NOT NULL`
        )
      )
      .groupBy(ImageMetadataTable.cameraMake, ImageMetadataTable.cameraModel)
      .orderBy(desc(sql`count(distinct ${FileTable.id})`));

    return cameras.map((c) => ({
      make: c.cameraMake!,
      model: c.cameraModel!,
      count: c.count,
    }));
  }),

  getFilesByCamera: privateProcedure
    .input(
      z.object({
        make: z.string(),
        model: z.string(),
        limit: z.number().int().positive().max(200).default(60),
        cursor: z.string().uuid().nullable().optional(),
      })
    )
    .query(async ({ ctx: { userId }, input }) => {
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const { make, model, limit, cursor } = input;

      // If cursor provided, get the sort value of that record to paginate from
      let cursorCondition: ReturnType<typeof sql> | undefined;
      if (cursor) {
        const [cursorRecord] = await db
          .select({
            sortTs: sql<Date>`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`,
          })
          .from(FileTable)
          .leftJoin(
            ImageMetadataTable,
            eq(ImageMetadataTable.fileId, FileTable.id)
          )
          .where(eq(FileTable.id, cursor))
          .limit(1);

        if (cursorRecord) {
          cursorCondition = sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt}) < ${cursorRecord.sortTs}`;
        }
      }

      const rows = await db
        .select({
          file: FileTable,
          libraryId: LibraryTable.id,
          libraryFileId: LibraryFileTable.id,
        })
        .from(ImageMetadataTable)
        .innerJoin(FileTable, eq(FileTable.id, ImageMetadataTable.fileId))
        .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
        .innerJoin(
          LibraryTable,
          eq(LibraryTable.id, LibraryFileTable.libraryId)
        )
        .where(
          and(
            eq(LibraryTable.userId, userId),
            isNull(LibraryFileTable.deletedAt),
            eq(ImageMetadataTable.cameraMake, make),
            eq(ImageMetadataTable.cameraModel, model),
            // Only include files that have BOTH thumbnail and optimised variants
            sql`EXISTS (
              SELECT 1 FROM ${FileVariantTable}
              WHERE ${FileVariantTable.originalFileId} = ${FileTable.id}
              AND ${FileVariantTable.type} = 'thumbnail'
            )`,
            sql`EXISTS (
              SELECT 1 FROM ${FileVariantTable}
              WHERE ${FileVariantTable.originalFileId} = ${FileTable.id}
              AND ${FileVariantTable.type} = 'optimised'
            )`,
            ...(cursorCondition ? [cursorCondition] : [])
          )
        )
        .orderBy(
          desc(
            sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`
          )
        )
        .limit(limit + 1);

      const data = rows.map((r) => ({
        ...r.file,
        libraryId: r.libraryId,
        libraryFileId: r.libraryFileId,
      }));

      const hasMore = data.length > limit;
      const items = hasMore ? data.slice(0, limit) : data;
      const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

      return { items, nextCursor };
    }),
});
