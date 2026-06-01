import { TRPCError } from "@trpc/server";
import { and, desc, exists, isNull, isNotNull, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { hiddenPeopleFilter } from "../db/file-filters.js";
import { z } from "zod";
import {
  buildFileAccessFilter,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { fileSortExpr, galleryOrderBy, keysetBefore } from "../db/file-sort.js";
import {
  FileTable,
  FileVariantTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
} from "../db/schema.js";
import { privateProcedure, router } from "../trpc.js";

// Group only by takenAt year. Files with no takenAt form a null group ("No Date")
// rather than being bucketed into their import year.
const yearExpr = sql<number | null>`CAST(strftime('%Y', ${FileTable.takenAt}) AS INTEGER)`;

export const yearsRouter = router({
  getYears: privateProcedure.query(async ({ ctx: { userId, session } }) => {
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

    const accessScope = await getAccessScope(userId, session);

    const years = await db
      .select({
        year: yearExpr,
        count: sql<number>`count(distinct ${FileTable.id})`,
        // Cover: first file in this year bucket (or null-bucket) that has a thumbnail.
        // The CASE handles the null group: correlated on IS NULL rather than = NULL.
        cover: sql<string | null>`(
          SELECT f2.id
          FROM file f2
          INNER JOIN library_file lf2 ON lf2.file_id = f2.id
          WHERE lf2.deleted_at IS NULL
            AND (
              (file.taken_at IS NULL AND f2.taken_at IS NULL)
              OR (file.taken_at IS NOT NULL AND CAST(strftime('%Y', f2.taken_at) AS INTEGER) = CAST(strftime('%Y', file.taken_at) AS INTEGER))
            )
            AND EXISTS (SELECT 1 FROM file_variant fv WHERE fv.original_file_id = f2.id AND fv.type = 'thumbnail')
          ORDER BY COALESCE(f2.taken_at, f2.created_at) DESC
          LIMIT 1
        )`,
      })
      .from(FileTable)
      .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
      .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
      .where(
        and(
          buildFileAccessFilter(accessScope, FileTable.id),
          isNull(LibraryFileTable.deletedAt),
        ),
      )
      .groupBy(yearExpr)
      // DESC: largest year first, NULL (no takenAt) sorts last in SQLite DESC
      .orderBy(desc(yearExpr));

    return years;
  }),

  getTimelineByYear: privateProcedure
    .input(
      z.object({
        year: z.number().int().min(1800).max(2100).nullable(),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      // No-date bucket has no temporal structure; nothing to scrub.
      if (input.year === null) return { months: [], total: 0 };

      const [accessScope, hiddenFilter] = await Promise.all([
        getAccessScope(userId, session),
        hiddenPeopleFilter(FileTable.id),
      ]);

      const sortExpr = sql`${FileTable.takenAt}`;

      const months = await db
        .select({
          year: sql<number>`cast(strftime('%Y', ${sortExpr}) as integer)`,
          month: sql<number>`cast(strftime('%m', ${sortExpr}) as integer)`,
          count: sql<number>`count(*)`,
        })
        .from(FileTable)
        .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
        .where(
          and(
            buildFileAccessFilter(accessScope, FileTable.id),
            isNull(LibraryFileTable.deletedAt),
            isNotNull(FileTable.takenAt),
            sql`CAST(strftime('%Y', ${FileTable.takenAt}) AS INTEGER) = ${input.year}`,
            ...(hiddenFilter ? [hiddenFilter] : []),
            exists(
              db.select().from(FileVariantTable).where(
                and(eq(FileVariantTable.originalFileId, FileTable.id), eq(FileVariantTable.type, "thumbnail")),
              ),
            ),
            exists(
              db.select().from(FileVariantTable).where(
                and(eq(FileVariantTable.originalFileId, FileTable.id), eq(FileVariantTable.type, "optimised")),
              ),
            ),
          ),
        )
        .groupBy(sql`strftime('%Y', ${sortExpr})`, sql`strftime('%m', ${sortExpr})`)
        .orderBy(
          desc(sql`cast(strftime('%Y', ${sortExpr}) as integer)`),
          desc(sql`cast(strftime('%m', ${sortExpr}) as integer)`),
        );

      const total = months.reduce((sum, m) => sum + m.count, 0);
      return { months, total };
    }),

  getFilesByYear: privateProcedure
    .input(
      z.object({
        // null = "No Date" bucket (takenAt IS NULL)
        year: z.number().int().min(1800).max(2100).nullable(),
        limit: z.number().int().positive().max(200).default(60),
        cursor: z.string().uuid().nullable().optional(),
        seekCursor: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const { year, limit, cursor, seekCursor } = input;
      const accessScope = await getAccessScope(userId, session);

      let cursorCondition: ReturnType<typeof sql> | undefined;
      if (cursor) {
        const [cursorRecord] = await db
          .select({ sortTs: fileSortExpr, id: FileTable.id })
          .from(FileTable)
          .where(eq(FileTable.id, cursor))
          .limit(1);
        if (cursorRecord?.sortTs) {
          cursorCondition = keysetBefore(fileSortExpr, cursorRecord.sortTs, cursorRecord.id);
        }
      } else if (seekCursor) {
        cursorCondition = sql`${fileSortExpr} < ${seekCursor}`;
      }

      const yearFilter =
        year === null
          ? isNull(FileTable.takenAt)
          : sql`CAST(strftime('%Y', ${FileTable.takenAt}) AS INTEGER) = ${year}`;

      const rows = await db
        .select({
          file: FileTable,
          libraryId: LibraryTable.id,
          libraryFileId: LibraryFileTable.id,
          blurhash: ImageMetadataTable.blurhash,
        })
        .from(FileTable)
        .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
        .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
        .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
        .where(
          and(
            buildFileAccessFilter(accessScope, FileTable.id),
            isNull(LibraryFileTable.deletedAt),
            yearFilter,
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
            ...(cursorCondition ? [cursorCondition] : []),
          ),
        )
        .orderBy(...galleryOrderBy(fileSortExpr))
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

      return { items, nextCursor };
    }),
});
