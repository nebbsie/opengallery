import { and, desc, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildFileAccessFilter,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import {
  FileTable,
  FileTaskTable,
  FileVariantTable,
  GeoLocationTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
} from "../db/schema.js";
import {
  adminProcedure,
  internalProcedure,
  privateProcedure,
  router,
} from "../trpc.js";
import { hiddenPeopleFilter } from "../db/file-filters.js";

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

  getAllLocations: privateProcedure.query(
    async ({ ctx: { userId, session } }) => {
      if (!userId) {
        throw new Error("Unauthorized");
      }

      const [accessScope, hiddenFilter] = await Promise.all([
        getAccessScope(userId, session),
        hiddenPeopleFilter(FileTable.id),
      ]);

      const locations = await db
        .select({
          lat: GeoLocationTable.lat,
          lon: GeoLocationTable.lon,
          count: sql<number>`count(distinct ${FileTable.id})`,
        })
        .from(GeoLocationTable)
        .innerJoin(FileTable, eq(FileTable.id, GeoLocationTable.fileId))
        .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
        .innerJoin(
          LibraryTable,
          eq(LibraryTable.id, LibraryFileTable.libraryId),
        )
        .where(
          and(
            buildFileAccessFilter(accessScope, FileTable.id),
            isNull(LibraryFileTable.deletedAt),
            hiddenFilter,
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
    },
  ),

  getFilesByLocation: privateProcedure
    .input(
      z.object({
        lat: z.number(),
        lon: z.number(),
        limit: z.number().int().positive().max(200).default(60),
        cursor: z.string().uuid().nullable().optional(),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) {
        throw new Error("Unauthorized");
      }

      const { lat, lon, limit, cursor } = input;
      const radiusDegrees = 5 / 69;
      const [accessScope, hiddenFilter] = await Promise.all([
        getAccessScope(userId, session),
        hiddenPeopleFilter(FileTable.id),
      ]);

      let cursorCondition: ReturnType<typeof sql> | undefined;
      if (cursor) {
        const [cursorRecord] = await db
          .select({
            sortTs: FileTable.takenAt,
          })
          .from(FileTable)
          .where(eq(FileTable.id, cursor))
          .limit(1);

        if (cursorRecord?.sortTs) {
          cursorCondition = sql`${FileTable.takenAt} < ${cursorRecord.sortTs}`;
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
            buildFileAccessFilter(accessScope, FileTable.id),
            isNull(LibraryFileTable.deletedAt),
            hiddenFilter,
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
          desc(sql`coalesce(${FileTable.takenAt}, ${FileTable.createdAt})`),
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

  // Wipe all stored coordinates and re-queue GPS extraction for the entire
  // library. Use after importing media that was encoded before geolocation
  // extraction existed (the encode step skips already-encoded files, so their
  // GPS was never read). Cheap: the worker only re-reads EXIF / ffprobe tags,
  // it does not re-encode. Admin-only since it touches every file.
  rescanAll: adminProcedure.mutation(async () => {
    const now = new Date().toISOString();

    // Count before mutating. `.returning()` on a whole-library delete/update
    // would materialise one row object per affected file; on a large library
    // that overflows the call stack, so we read counts separately instead.
    const [coordRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(GeoLocationTable);
    const coordinatesDeleted = Number(coordRow?.count ?? 0);

    const [taskRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(FileTaskTable)
      .where(eq(FileTaskTable.type, "extract_geolocation"));
    const tasksReset = Number(taskRow?.count ?? 0);

    // 1. Drop every stored coordinate so the rescan is authoritative.
    await db.delete(GeoLocationTable);

    // 2. Reset existing extract_geolocation tasks back to pending.
    await db
      .update(FileTaskTable)
      .set({
        status: "pending",
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        progress: 0,
        updatedAt: now,
      })
      .where(eq(FileTaskTable.type, "extract_geolocation"));

    // 3. Create tasks for any files that predate the extract_geolocation task
    //    (imported before this feature) and therefore have no task row yet.
    const missing = await db
      .select({ id: FileTable.id })
      .from(FileTable)
      .where(
        and(
          // Skip thumbnail/optimised outputs: they are stored as their own file
          // rows (files.saveVariants) but carry no EXIF GPS of their own.
          notExists(
            db
              .select()
              .from(FileVariantTable)
              .where(eq(FileVariantTable.fileId, FileTable.id)),
          ),
          notExists(
            db
              .select()
              .from(FileTaskTable)
              .where(
                and(
                  eq(FileTaskTable.fileId, FileTable.id),
                  eq(FileTaskTable.type, "extract_geolocation"),
                ),
              ),
          ),
        ),
      );

    // Insert in chunks: a single multi-thousand-row INSERT builds a deeply
    // nested statement that overflows the call stack in better-sqlite3.
    const CHUNK = 500;
    for (let i = 0; i < missing.length; i += CHUNK) {
      await db
        .insert(FileTaskTable)
        .values(
          missing.slice(i, i + CHUNK).map((m) => ({
            fileId: m.id,
            type: "extract_geolocation" as const,
          })),
        )
        .onConflictDoNothing();
    }

    return {
      coordinatesDeleted,
      tasksReset,
      tasksCreated: missing.length,
    };
  }),

  // Reconcile extract_geolocation tasks against the current library. Idempotent
  // and self-healing, so the geo worker runs it on every boot:
  //   1. Delete tasks targeting variant outputs (thumbnail/optimised files carry
  //      no EXIF GPS of their own and would skip forever, polluting the queue).
  //   2. Seed a task for every real file (image or video) that lacks one.
  //   3. Revive dead tasks (failed at the attempt cap) so a fix to a systemic
  //      failure — e.g. the geo_location upsert constraint — re-drives them
  //      instead of leaving coordinates permanently unread.
  backfillTasks: internalProcedure.mutation(async () => {
    // 1. Drop bogus tasks on variant outputs.
    const purged = await db
      .delete(FileTaskTable)
      .where(
        and(
          eq(FileTaskTable.type, "extract_geolocation"),
          exists(
            db
              .select()
              .from(FileVariantTable)
              .where(eq(FileVariantTable.fileId, FileTaskTable.fileId)),
          ),
        ),
      )
      .returning({ id: FileTaskTable.id });

    // 2. Seed for real files (non-variant) that have no task yet.
    const missing = await db
      .select({ id: FileTable.id })
      .from(FileTable)
      .where(
        and(
          notExists(
            db
              .select()
              .from(FileVariantTable)
              .where(eq(FileVariantTable.fileId, FileTable.id)),
          ),
          notExists(
            db
              .select()
              .from(FileTaskTable)
              .where(
                and(
                  eq(FileTaskTable.fileId, FileTable.id),
                  eq(FileTaskTable.type, "extract_geolocation"),
                ),
              ),
          ),
        ),
      );

    let seeded = 0;
    const CHUNK = 500;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const res = await db
        .insert(FileTaskTable)
        .values(
          missing.slice(i, i + CHUNK).map((m) => ({
            fileId: m.id,
            type: "extract_geolocation" as const,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: FileTaskTable.id });
      seeded += res.length;
    }

    // 3. Revive dead tasks so a deploy that fixes the underlying cause re-drives
    //    them. Cheap: extraction only re-reads EXIF / ffprobe tags.
    const now = new Date().toISOString();
    const revived = await db
      .update(FileTaskTable)
      .set({
        status: "pending",
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        progress: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(FileTaskTable.type, "extract_geolocation"),
          eq(FileTaskTable.status, "failed"),
          sql`${FileTaskTable.attempts} >= 3`,
        ),
      )
      .returning({ id: FileTaskTable.id });

    // 4. Re-drive tasks marked succeeded that have no coordinate row. A
    //    succeeded geo task should always have a geo_location row (no GPS ->
    //    skipped, not succeeded); a missing row means the coordinate was lost
    //    (e.g. the pre-unique-constraint era) and the file's GPS is unread.
    const reconciled = await db
      .update(FileTaskTable)
      .set({
        status: "pending",
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        progress: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(FileTaskTable.type, "extract_geolocation"),
          eq(FileTaskTable.status, "succeeded"),
          notExists(
            db
              .select()
              .from(GeoLocationTable)
              .where(eq(GeoLocationTable.fileId, FileTaskTable.fileId)),
          ),
        ),
      )
      .returning({ id: FileTaskTable.id });

    return {
      seeded,
      purged: purged.length,
      revived: revived.length,
      reconciled: reconciled.length,
    };
  }),
});
