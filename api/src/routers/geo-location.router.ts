import { and, desc, eq, exists, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  FileTable,
  FileVariantTable,
  GeoLocationTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
} from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

export const geoLocationRouter = router({
  save: internalProcedure
    .input(
      z.object({
        fileId: z.string(),
        lat: z.number(),
        lon: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      if (
        input.lat < -90 ||
        input.lat > 90 ||
        input.lon < -180 ||
        input.lon > 180
      ) {
        return null;
      }

      const [result] = await db
        .insert(GeoLocationTable)
        .values({
          fileId: input.fileId,
          lat: input.lat,
          lon: input.lon,
        })
        .onConflictDoUpdate({
          target: GeoLocationTable.fileId,
          set: {
            lat: input.lat,
            lon: input.lon,
          },
        })
        .returning();

      return result;
    }),

  getAllLocations: privateProcedure.query(async ({ ctx: { userId } }) => {
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const locations = await db
      .select({
        lat: GeoLocationTable.lat,
        lon: GeoLocationTable.lon,
        count: sql<number>`count(distinct ${FileTable.id})`,
      })
      .from(GeoLocationTable)
      .innerJoin(FileTable, eq(FileTable.id, GeoLocationTable.fileId))
      .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
      .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
      .where(
        and(
          eq(LibraryTable.userId, userId),
          isNull(LibraryFileTable.deletedAt),
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
      .groupBy(GeoLocationTable.lat, GeoLocationTable.lon)
      .orderBy(desc(sql`count(distinct ${FileTable.id})`));

    return locations.map((l) => ({
      lat: l.lat,
      lon: l.lon,
      count: l.count,
    }));
  }),

  getFilesByLocation: privateProcedure
    .input(
      z.object({
        lat: z.number(),
        lon: z.number(),
        limit: z.number().int().positive().max(200).default(60),
        cursor: z.string().uuid().nullable().optional(),
      }),
    )
    .query(async ({ ctx: { userId }, input }) => {
      if (!userId) {
        throw new Error("Unauthorized");
      }

      const { lat, lon, limit, cursor } = input;
      const radiusDegrees = 5 / 69;

      let cursorCondition: ReturnType<typeof sql> | undefined;
      if (cursor) {
        const [cursorRecord] = await db
          .select({
            sortTs: ImageMetadataTable.takenAt,
          })
          .from(FileTable)
          .innerJoin(
            ImageMetadataTable,
            eq(ImageMetadataTable.fileId, FileTable.id),
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
          lat: GeoLocationTable.lat,
          lon: GeoLocationTable.lon,
        })
        .from(GeoLocationTable)
        .innerJoin(FileTable, eq(FileTable.id, GeoLocationTable.fileId))
        .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
        .innerJoin(
          LibraryTable,
          eq(LibraryTable.id, LibraryFileTable.libraryId),
        )
        .leftJoin(
          ImageMetadataTable,
          eq(ImageMetadataTable.fileId, FileTable.id),
        )
        .where(
          and(
            eq(LibraryTable.userId, userId),
            isNull(LibraryFileTable.deletedAt),
            sql`${GeoLocationTable.lat} BETWEEN ${lat - radiusDegrees} AND ${lat + radiusDegrees}`,
            sql`${GeoLocationTable.lon} BETWEEN ${lon - radiusDegrees} AND ${lon + radiusDegrees}`,
            sql`(6371 * acos(cos(radians(${lat})) * cos(radians(${GeoLocationTable.lat})) * cos(radians(${GeoLocationTable.lon}) - radians(${lon})) + sin(radians(${lat})) * sin(radians(${GeoLocationTable.lat})))) < 8.04672`,
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
            ...(cursorCondition ? [cursorCondition] : []),
          ),
        )
        .orderBy(
          desc(
            sql`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`,
          ),
        )
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
