import { TRPCError } from "@trpc/server";
import { and, desc, exists, gte, isNull, isNotNull, lt, sql } from "drizzle-orm";
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
import { hasRawOf } from "../utils/raw-pairing.js";

// Group only by takenAt year. Files with no takenAt form a null group ("No Date")
// rather than being bucketed into their import year.
const yearExpr = sql<number | null>`CAST(strftime('%Y', ${FileTable.takenAt}) AS INTEGER)`;

// A year as a [from, to) range on an ISO timestamp column. taken_at is always
// a toISOString() value, so a plain string range matches the same rows as
// CAST(strftime('%Y', taken_at) AS INTEGER) = year, but can use an index.
const yearRange = (year: number) => ({
  from: `${year}-01-01`,
  to: `${year + 1}-01-01`,
});

export const yearsRouter = router({
  getYears: privateProcedure.query(async ({ ctx: { userId, session } }) => {
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

    const [accessScope, hiddenFilter] = await Promise.all([
      getAccessScope(userId, session),
      hiddenPeopleFilter(FileTable.id),
    ]);

    const hasThumbnail = sql`exists (select 1 from ${FileVariantTable} where ${FileVariantTable.originalFileId} = ${FileTable.id} and ${FileVariantTable.type} = 'thumbnail')`;

    // One pass over the library. The cover is the newest file of the year
    // (or of the null "No Date" group) that has a thumbnail: with exactly one
    // max() aggregate in the select, SQLite takes the bare column file.id
    // from the row that holds that max. Rows without a thumbnail give NULL to
    // max(); when no row of a group has one, coverSort is NULL and so is the
    // cover. This replaces a correlated subquery that re-scanned the whole
    // library once per year (21 scans for 21 years).
    const rows = await db
      .select({
        year: yearExpr,
        count: sql<number>`count(distinct ${FileTable.id})`,
        coverId: FileTable.id,
        coverSort: sql<string | null>`max(case when ${hasThumbnail} then ${fileSortExpr} end)`,
      })
      .from(FileTable)
      .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
      .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
      .where(
        and(
          buildFileAccessFilter(accessScope, FileTable.id),
          isNull(LibraryFileTable.deletedAt),
          hiddenFilter,
        ),
      )
      .groupBy(yearExpr)
      // DESC: largest year first, NULL (no takenAt) sorts last in SQLite DESC
      .orderBy(desc(yearExpr));

    return rows.map((r) => ({
      year: r.year,
      count: r.count,
      cover: r.coverSort === null ? null : r.coverId,
    }));
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

      const { from, to } = yearRange(input.year);
      // 'YYYY-MM' bucket (see getTimeline in files.router.ts).
      const bucket = sql`substr(${FileTable.takenAt}, 1, 7)`;

      const months = await db
        .select({
          year: sql<number>`cast(substr(${FileTable.takenAt}, 1, 4) as integer)`,
          month: sql<number>`cast(substr(${FileTable.takenAt}, 6, 2) as integer)`,
          count: sql<number>`count(*)`,
        })
        .from(FileTable)
        .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
        .where(
          and(
            buildFileAccessFilter(accessScope, FileTable.id),
            isNull(LibraryFileTable.deletedAt),
            // Range on file_taken_at_idx instead of strftime() on every row.
            gte(FileTable.takenAt, from),
            lt(FileTable.takenAt, to),
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
        .groupBy(bucket)
        .orderBy(desc(bucket));

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
      const [accessScope, hiddenFilter] = await Promise.all([
        getAccessScope(userId, session),
        hiddenPeopleFilter(FileTable.id),
      ]);

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

      // A dated year is a range on the ORDER BY expression itself (taken_at is
      // set, so fileSortExpr = taken_at), so the page is a seek on
      // file_taken_created_sort_idx that stops after limit+1 rows.
      const yearFilter =
        year === null
          ? isNull(FileTable.takenAt)
          : and(
              isNotNull(FileTable.takenAt),
              gte(fileSortExpr, yearRange(year).from),
              lt(fileSortExpr, yearRange(year).to),
            );

      const rows = await db
        .select({
          file: FileTable,
          libraryId: LibraryTable.id,
          libraryFileId: LibraryFileTable.id,
          blurhash: ImageMetadataTable.blurhash,
          width: ImageMetadataTable.width,
          height: ImageMetadataTable.height,
        })
        // CROSS JOIN keeps file as the outer loop. With an INNER JOIN the
        // planner starts from library_file (the capped prod stats claim a
        // library has ~400 rows) and sorts the whole library.
        .from(FileTable)
        .crossJoin(LibraryFileTable)
        .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
        .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
        .where(
          and(
            eq(LibraryFileTable.fileId, FileTable.id),
            buildFileAccessFilter(accessScope, FileTable.id),
            isNull(LibraryFileTable.deletedAt),
            yearFilter,
            // Match getTimelineByYear: hidden people never show in browse views.
            hiddenFilter,
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
        hasRaw: hasRawOf(r.file),
        libraryId: r.libraryId,
        libraryFileId: r.libraryFileId,
        blurhash: r.blurhash,
        width: r.width,
        height: r.height,
      }));

      const hasMore = data.length > limit;
      const items = hasMore ? data.slice(0, limit) : data;
      const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

      return { items, nextCursor };
    }),
});
