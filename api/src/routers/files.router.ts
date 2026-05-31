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
  cameraSortExpr,
  fileSortExpr,
  galleryOrderBy,
  keysetAfter,
  keysetBefore,
  UNDATED_SORT_SENTINEL,
  undatedBottomSortExpr,
} from "../db/file-sort.js";
import {
  AlbumFileTable,
  AlbumTable,
  FaceTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
  GeoLocationTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
  PersonTable,
  VideoMetadataTable,
} from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { hiddenPeopleFilter } from "../db/file-filters.js";
import {
  deleteFilesWithCascade,
  deleteVariantFilesFromDisk,
  removeFacesForFiles,
} from "../utils/file-operations.js";
import { getCachedMediaSettings } from "../utils/settings-cache.js";
import { wsManager } from "../ws-manager.js";

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
          taskRows.push({ fileId: f.id, type: "detect_faces" });
        } else {
          taskRows.push({ fileId: f.id, type: "video_poster" });
          taskRows.push({ fileId: f.id, type: "encode_optimised" });
        }
        // GPS extraction runs independently of encoding (it only reads EXIF /
        // ffprobe tags off the original) so geolocation lands even when the
        // encode step is skipped because variants already exist.
        taskRows.push({ fileId: f.id, type: "extract_geolocation" });
      }
      if (taskRows.length) {
        await db.insert(FileTaskTable).values(taskRows);
      }

      return addedFiles;
    }),

  getFilesInDir: privateProcedure
    .input(z.string())
    .query(({ input }) =>
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

  // Re-process a file whose content changed on disk (D4). Drops all derived
  // data (variants on disk + rows, image/video/geo metadata, faces) and resets
  // the file's tasks to pending so the worker regenerates everything from the
  // new content. The original FileTable row (and its id) is kept; only its
  // size/hash are refreshed and takenAt is cleared for re-extraction.
  refreshChangedFile: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        size: z.number(),
        contentHash: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [file] = await db
        .select({ id: FileTable.id })
        .from(FileTable)
        .where(eq(FileTable.id, input.fileId))
        .limit(1);
      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `File not found: ${input.fileId}`,
        });
      }

      const now = new Date().toISOString();

      // Resolve the generated variant outputs (each is its own FileTable row).
      const variantRows = await db
        .select({ fileId: FileVariantTable.fileId })
        .from(FileVariantTable)
        .where(eq(FileVariantTable.originalFileId, input.fileId));
      const variantFileIds = variantRows.map((r) => r.fileId);

      // Drop stale derived data. Order matters for FKs: video_metadata.poster
      // references file_variant, so clear metadata before the variant rows.
      await db
        .delete(VideoMetadataTable)
        .where(eq(VideoMetadataTable.fileId, input.fileId));
      await db
        .delete(ImageMetadataTable)
        .where(eq(ImageMetadataTable.fileId, input.fileId));
      await db
        .delete(GeoLocationTable)
        .where(eq(GeoLocationTable.fileId, input.fileId));
      await removeFacesForFiles([input.fileId]);

      await deleteVariantFilesFromDisk([input.fileId]);
      await db
        .delete(FileVariantTable)
        .where(eq(FileVariantTable.originalFileId, input.fileId));
      if (variantFileIds.length > 0) {
        await db
          .delete(FileTable)
          .where(inArray(FileTable.id, variantFileIds));
      }

      // Re-drive every task for this file from scratch.
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
        .where(eq(FileTaskTable.fileId, input.fileId));

      await db
        .update(FileTable)
        .set({
          size: input.size,
          contentHash: input.contentHash ?? null,
          takenAt: null,
          updatedAt: now,
        })
        .where(eq(FileTable.id, input.fileId));

      return { ok: true };
    }),

  getAllFiles: internalProcedure.query(() => db.select().from(FileTable)),

  viewFile: privateProcedure
    .input(
      z.object({
        fileId: z.string(),
        albumId: z.string().uuid().optional(),
        cameraMake: z.string().optional(),
        cameraModel: z.string().optional(),
        kind: z.enum(['image', 'video', 'all']).optional(),
        personId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ input, ctx: { userId, session } }) => {
      const { fileId, albumId, cameraMake, cameraModel, kind, personId } = input;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const [accessScope, hideUndated, hiddenFilter] = await Promise.all([
        getAccessScope(userId, session),
        getHideUndated(userId),
        hiddenPeopleFilter(FileTable.id),
      ]);

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

      // People detected in this file: one entry per clustered person, using
      // the face crop from *this* image as the avatar. We prefer a face that
      // has an avatar crop on disk so the chip renders, and skip people the
      // user has explicitly hidden.
      const faceRows = await db
        .select({
          faceId: FaceTable.id,
          personId: FaceTable.personId,
          name: PersonTable.name,
          cropName: FaceTable.cropName,
        })
        .from(FaceTable)
        .innerJoin(PersonTable, eq(PersonTable.id, FaceTable.personId))
        .where(
          and(eq(FaceTable.fileId, file.id), eq(PersonTable.hidden, false)),
        );

      const peopleByPerson = new Map<
        string,
        { personId: string; faceId: string; name: string | null; hasCrop: boolean }
      >();
      for (const row of faceRows) {
        if (!row.personId) continue;
        const hasCrop = !!row.cropName;
        const existing = peopleByPerson.get(row.personId);
        // Keep the first face we see for a person, but upgrade to one that has
        // a crop avatar if the earlier pick didn't have one.
        if (!existing || (!existing.hasCrop && hasCrop)) {
          peopleByPerson.set(row.personId, {
            personId: row.personId,
            faceId: row.faceId,
            name: row.name,
            hasCrop,
          });
        }
      }
      // Named people first, then unnamed — matches the People page ordering.
      const people = [...peopleByPerson.values()].sort((a, b) => {
        if (!!a.name === !!b.name) return 0;
        return a.name ? -1 : 1;
      });

      // Compute prev/next IDs using keyset pagination on the same total order
      // used by the grid: (coalesce(takenAt, createdAt) DESC, files.id DESC).
      // We must include id as a tiebreaker in BOTH the WHERE comparison and the
      // ORDER BY, otherwise navigation is non-deterministic for items that share
      // a sort value (e.g. burst shots, missing takenAt). Without this, right →
      // left does not round-trip back to the starting asset.
      const currentSortValue = imageMetadata?.takenAt ?? file.createdAt;
      const currentId = file.id;

      let prevId: string | null = null;
      let nextId: string | null = null;

      const kindFilter = kind && kind !== 'all' ? eq(FileTable.type, kind) : undefined;

      // Only navigate to files that are fully encoded and visible in the gallery,
      // matching the same filters getUsersFiles applies.
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

      if (albumId) {
        // Album context: keyset on the same total order the album grid uses.
        const [prev] = await db
          .select({ id: FileTable.id })
          .from(AlbumFileTable)
          .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
          .innerJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
          .where(
            and(
              eq(AlbumFileTable.albumId, albumId),
              buildFileAccessFilter(accessScope, FileTable.id),
              kindFilter,
              hasThumbnail,
              hasOptimised,
              keysetAfter(fileSortExpr, currentSortValue, currentId),
            ),
          )
          .orderBy(sql`${fileSortExpr} ASC`, FileTable.id)
          .limit(1);

        const [next] = await db
          .select({ id: FileTable.id })
          .from(AlbumFileTable)
          .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
          .innerJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
          .where(
            and(
              eq(AlbumFileTable.albumId, albumId),
              buildFileAccessFilter(accessScope, FileTable.id),
              kindFilter,
              hasThumbnail,
              hasOptimised,
              keysetBefore(fileSortExpr, currentSortValue, currentId),
            ),
          )
          .orderBy(...galleryOrderBy(fileSortExpr))
          .limit(1);

        prevId = prev?.id ?? null;
        nextId = next?.id ?? null;
      } else if (cameraMake && cameraModel) {
        // Camera context: keyset on the same total order the camera grid uses.
        const [prev] = await db
          .select({ id: FileTable.id })
          .from(ImageMetadataTable)
          .innerJoin(FileTable, eq(FileTable.id, ImageMetadataTable.fileId))
          .where(
            and(
              buildFileAccessFilter(accessScope, FileTable.id),
              kindFilter,
              hasThumbnail,
              hasOptimised,
              hiddenFilter,
              eq(ImageMetadataTable.cameraMake, cameraMake),
              eq(ImageMetadataTable.cameraModel, cameraModel),
              isNotNull(ImageMetadataTable.takenAt),
              keysetAfter(cameraSortExpr, currentSortValue, currentId),
            ),
          )
          .orderBy(sql`${cameraSortExpr} ASC`, FileTable.id)
          .limit(1);

        const [next] = await db
          .select({ id: FileTable.id })
          .from(ImageMetadataTable)
          .innerJoin(FileTable, eq(FileTable.id, ImageMetadataTable.fileId))
          .where(
            and(
              buildFileAccessFilter(accessScope, FileTable.id),
              kindFilter,
              hasThumbnail,
              hasOptimised,
              hiddenFilter,
              eq(ImageMetadataTable.cameraMake, cameraMake),
              eq(ImageMetadataTable.cameraModel, cameraModel),
              isNotNull(ImageMetadataTable.takenAt),
              keysetBefore(cameraSortExpr, currentSortValue, currentId),
            ),
          )
          .orderBy(...galleryOrderBy(cameraSortExpr))
          .limit(1);

        prevId = prev?.id ?? null;
        nextId = next?.id ?? null;
      } else if (personId) {
        // Person context: same order as getPersonFiles (fileSortExpr DESC).
        const [prev] = await db
          .select({ id: FileTable.id })
          .from(FaceTable)
          .innerJoin(FileTable, eq(FileTable.id, FaceTable.fileId))
          .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
          .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
          .where(
            and(
              eq(FaceTable.personId, personId),
              buildFileAccessFilter(accessScope, FileTable.id),
              isNull(LibraryFileTable.deletedAt),
              hasThumbnail,
              hasOptimised,
              keysetAfter(fileSortExpr, currentSortValue, currentId),
            ),
          )
          .groupBy(FileTable.id)
          .orderBy(sql`${fileSortExpr} ASC`, FileTable.id)
          .limit(1);

        const [next] = await db
          .select({ id: FileTable.id })
          .from(FaceTable)
          .innerJoin(FileTable, eq(FileTable.id, FaceTable.fileId))
          .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
          .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
          .where(
            and(
              eq(FaceTable.personId, personId),
              buildFileAccessFilter(accessScope, FileTable.id),
              isNull(LibraryFileTable.deletedAt),
              hasThumbnail,
              hasOptimised,
              keysetBefore(fileSortExpr, currentSortValue, currentId),
            ),
          )
          .groupBy(FileTable.id)
          .orderBy(...galleryOrderBy(fileSortExpr))
          .limit(1);

        prevId = prev?.id ?? null;
        nextId = next?.id ?? null;
      } else {
        // Global library context: keyset on the same total order getUsersFiles
        // uses — undated sunk to the bottom via the sentinel, and undated hidden
        // entirely when the user has that turned off.
        const globalSortValue = imageMetadata?.takenAt ?? UNDATED_SORT_SENTINEL;
        const undatedFilter = hideUndated
          ? isNotNull(ImageMetadataTable.takenAt)
          : undefined;

        const [prev] = await db
          .select({ id: FileTable.id })
          .from(FileTable)
          .innerJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
          .where(
            and(
              buildFileAccessFilter(accessScope, FileTable.id),
              kindFilter,
              hasThumbnail,
              hasOptimised,
              hiddenFilter,
              undatedFilter,
              keysetAfter(undatedBottomSortExpr, globalSortValue, currentId),
            ),
          )
          .orderBy(sql`${undatedBottomSortExpr} ASC`, FileTable.id)
          .limit(1);

        const [next] = await db
          .select({ id: FileTable.id })
          .from(FileTable)
          .innerJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
          .where(
            and(
              buildFileAccessFilter(accessScope, FileTable.id),
              kindFilter,
              hasThumbnail,
              hasOptimised,
              hiddenFilter,
              undatedFilter,
              keysetBefore(undatedBottomSortExpr, globalSortValue, currentId),
            ),
          )
          .orderBy(...galleryOrderBy(undatedBottomSortExpr))
          .limit(1);

        prevId = prev?.id ?? null;
        nextId = next?.id ?? null;
      }

      const ownerLibraryIds = accessScope.ownedLibraryIds;

      return {
        file,
        imageMetadata: imageMetadata ?? null,
        geoLocation: geoLocation ?? null,
        people,
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

        wsManager.broadcast("file:variant-saved", {
          originalFileId,
          variantType: v.type,
        });
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

      const [accessScope, hiddenFilter] = await Promise.all([
        getAccessScope(userId, session),
        hiddenPeopleFilter(FileTable.id),
      ]);
      // The timeline is a date scrubber: it only buckets dated media. Undated
      // items have no month and render as a block at the bottom of the grid, so
      // they are always excluded here regardless of the show-undated setting.
      // Reads the denormalized file.taken_at so it can lean on file_taken_at_idx.
      const sortExpr = sql`${FileTable.takenAt}`;

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
            isNotNull(ImageMetadataTable.takenAt),
            ...(hiddenFilter ? [hiddenFilter] : []),
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
  const settings = await getCachedMediaSettings(userId);
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
  const [accessScope, hideUndated, hiddenFilter] = await Promise.all([
    getAccessScope(userId, session),
    getHideUndated(userId),
    hiddenPeopleFilter(FileTable.id),
  ]);

  // Undated media (no takenAt) is sunk to the bottom via the sentinel sort.
  const sortExpr = undatedBottomSortExpr;

  // Two cursor shapes:
  //  - Pagination cursor ("<sortAt>|<id>"): a full keyset so a block of items
  //    that share a sort value (notably all undated, which collapse to the
  //    sentinel) paginates correctly instead of being dropped at the boundary.
  //  - seekCursor (bare timestamp from a timeline jump): start just below the
  //    given date. Only ever sent for the first page.
  let cursorCondition: ReturnType<typeof sql> | undefined;
  if (cursor && cursor.includes("|")) {
    const sep = cursor.lastIndexOf("|");
    const ts = cursor.slice(0, sep);
    const id = cursor.slice(sep + 1);
    cursorCondition = keysetBefore(sortExpr, ts, id);
  } else {
    const effectiveCursor = cursor ?? seekCursor;
    if (effectiveCursor) cursorCondition = sql`${sortExpr} < ${effectiveCursor}`;
  }

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
        // Exclude photos of any hidden person (admin curation).
        ...(hiddenFilter ? [hiddenFilter] : []),
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
    .orderBy(...galleryOrderBy(sortExpr))
    .limit(limit + 1);

  const data = rows.map((r) => ({
    ...r.file,
    blurhash: r.blurhash,
    takenAt: r.takenAt,
    sortAt: r.sortAt,
  }));

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  const last = items[items.length - 1];
  // Encode the full keyset (sortAt + id) so the next page resumes deterministically.
  const nextCursor = hasMore && last ? `${last.sortAt}|${last.id}` : null;
  return { items, nextCursor } as const;
};
