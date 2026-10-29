import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import * as fs from "node:fs";
import path, { basename, extname } from "node:path";
import { resolveAssetPath } from "../utils/media-path.js";
import { z } from "zod";
import {
  buildFileAccessFilter,
  canUserViewFile,
  clearScopeCache,
  getAccessScope,
  isAdminSession,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import {
  cameraIdCol,
  cameraOrderBy,
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
  SharedItemTable,
  UserTable,
  VideoMetadataTable,
  ViewerHiddenFileTable,
  type FileVariantType,
} from "../db/schema.js";
import {
  adminProcedure,
  internalProcedure,
  privateProcedure,
  router,
} from "../trpc.js";
import { createDownloadTicket } from "../utils/zip-download.js";
import { withFaceLock } from "../faces/face-index.js";
import { hiddenPeopleFilter } from "../db/file-filters.js";
import {
  deleteFilesWithCascade,
  deleteRawPreviews,
  deleteVariantFilesFromDisk,
  demoteMotionFilesSync,
  demoteRawFilesSync,
  emptyRawEffects,
  fileTaskRows,
  finishRawMoves,
  motionTaskRows,
  reconcileMotionPairs,
  reconcileRawPairs,
  removeFacesForFiles,
} from "../utils/file-operations.js";
import {
  hasRawOf,
  isRawCompanion,
  isRawName,
  linkMotionPairs,
  linkRawPairs,
  rawIdsOf,
} from "../utils/raw-pairing.js";
import { getCachedMediaSettings } from "../utils/settings-cache.js";
import { wsManager } from "../ws-manager.js";

// 640 px aspect-kept grid thumbnail. Plain text in the DB; see saveVariants.
export const THUMBNAIL_LG = "thumbnail_lg" satisfies FileVariantType;

// Most items one bulk action (share, hide, download) takes at once.
const BULK_MAX = 5000;

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
      // Camera RAW+JPEG pairs (utils/raw-pairing.ts). A new RAW next to its
      // JPEG becomes the JPEG's hidden companion: no tasks, and the
      // libraryFile/albumFile links the scanner makes next are skipped for it.
      // A new JPEG next to a RAW-only photo takes over its data (demotion).
      // Insert, link and demote commit together, under the face lock because
      // faces can move; disk cleanup follows the commit.
      const fx = emptyRawEffects();
      const addedFiles = await withFaceLock(async () =>
        db.transaction(() => {
          const inserted = db.insert(FileTable).values(input).returning().all();
          const pairs = linkRawPairs(inserted.map((f) => f.id));
          // Live Photos: a short video next to its still becomes the still's
          // hidden motion companion (either order).
          const motion = linkMotionPairs(
            inserted.filter((f) => !pairs.companions.has(f.id)).map((f) => f.id),
          );
          const rawOfPhoto = new Map([...pairs.primaryOf].map(([raw, photo]) => [photo, raw]));
          const motionOfStill = new Map([...motion.stillOf].map(([video, still]) => [still, video]));
          const added = inserted.map((f) => ({
            ...f,
            rawFileId: rawOfPhoto.get(f.id) ?? f.rawFileId,
            motionFileId: motionOfStill.get(f.id) ?? f.motionFileId,
            // A hidden companion (RAW or Live Photo motion): the worker makes no
            // library or album links for it.
            rawCompanion: pairs.companions.has(f.id) || motion.companions.has(f.id),
          }));

          // Seed file tasks for downstream processing. A motion video only
          // needs what playback needs.
          const taskRows = added
            .filter((f) => !pairs.companions.has(f.id))
            .flatMap((f) => (motion.companions.has(f.id) ? motionTaskRows(f.id) : fileTaskRows(f.id, f.type)));
          for (let i = 0; i < taskRows.length; i += 500) {
            db.insert(FileTaskTable).values(taskRows.slice(i, i + 500)).run();
          }

          demoteRawFilesSync(pairs.primaryOf, pairs.demoted, fx);
          demoteMotionFilesSync(motion.demoted, fx);
          return added;
        }),
      );
      await finishRawMoves(fx);
      return addedFiles;
    }),

  // Repair half-done RAW pairs (utils/file-operations.ts reconcileRawPairs),
  // and pair or repair Live Photos (reconcileMotionPairs). Idempotent; the
  // worker calls it on boot.
  reconcileRawPairs: internalProcedure.mutation(async () => {
    const raw = await reconcileRawPairs();
    const motion = await reconcileMotionPairs();
    return { ...raw, motionPaired: motion.paired, motionRepaired: motion.repaired };
  }),

  getFilesInDir: internalProcedure
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
            // Exact prefix match: LIKE would treat `_`/`%` in the dir as
            // wildcards and match case-insensitively, deleting files from
            // unrelated sibling folders.
            or(
              eq(FileTable.dir, dir),
              sql`substr(${FileTable.dir}, 1, length(${dir + "/"})) = ${dir + "/"}`,
            ),
          ),
        );

      const fileIds = rows.map((r) => r.id);
      if (fileIds.length === 0) return [] as { id: string }[];

      // RAW companions have no library row; they go with their photos.
      return deleteFilesWithCascade([...fileIds, ...rawIdsOf(fileIds).values()]);
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
      await deleteRawPreviews([input.fileId]);
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

      // Same error as a missing file, so a viewer cannot tell a hidden file
      // (or one outside their shares) from one that does not exist.
      if (!(await canUserViewFile(userId, session, file.id))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `File not found: ${fileId}`,
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
          throw new TRPCError({ code: "NOT_FOUND" });
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
        // People hidden from this viewer never show as a chip.
        if (accessScope.hiddenPersonIds.has(row.personId)) continue;
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
        // Album context: keyset on the same total order and row set the album
        // grid (album.getAlbumInfo) uses, which left-joins image metadata.
        const [prev] = await db
          .select({ id: FileTable.id })
          .from(AlbumFileTable)
          .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
          .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
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
          .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
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
              keysetAfter(cameraSortExpr, currentSortValue, currentId, cameraIdCol),
            ),
          )
          .orderBy(sql`${cameraSortExpr} ASC`, cameraIdCol)
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
              keysetBefore(cameraSortExpr, currentSortValue, currentId, cameraIdCol),
            ),
          )
          .orderBy(...cameraOrderBy)
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

      // Albums this file belongs to (and the viewer can see), so the info panel
      // can link back to the containing album/folder regardless of how the user
      // reached this asset.
      const albumRows = await db
        .select({ id: AlbumTable.id, name: AlbumTable.name })
        .from(AlbumFileTable)
        .innerJoin(AlbumTable, eq(AlbumTable.id, AlbumFileTable.albumId))
        .where(eq(AlbumFileTable.fileId, file.id))
        .orderBy(AlbumTable.name);
      const albums = albumRows.filter((a) => accessScope.visibleAlbumIds.has(a.id));

      // Camera RAW: the companion of a RAW+JPEG pair, or the file itself when
      // it is a RAW-only photo. For the badge, the info panel and download.
      let raw: { name: string; size: number; paired: boolean } | null = null;
      if (file.rawFileId) {
        const [r] = await db
          .select({ name: FileTable.name, size: FileTable.size })
          .from(FileTable)
          .where(eq(FileTable.id, file.rawFileId))
          .limit(1);
        if (r) raw = { name: r.name, size: r.size, paired: true };
      } else if (isRawName(file.name)) {
        raw = { name: file.name, size: file.size, paired: false };
      }

      // Live Photo: the still's motion video, played through
      // /asset/<still id>/motion. For the viewer's LIVE switch and the info panel.
      let motion: { fileId: string; name: string } | null = null;
      if (file.motionFileId) {
        const [m] = await db
          .select({ name: FileTable.name })
          .from(FileTable)
          .where(eq(FileTable.id, file.motionFileId))
          .limit(1);
        if (m) motion = { fileId: file.motionFileId, name: m.name };
      }

      return {
        file,
        raw,
        motion,
        imageMetadata: imageMetadata ?? null,
        geoLocation: geoLocation ?? null,
        people,
        albums,
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
              // thumbnail_lg: 640 px on the short side, aspect kept, for
              // retina grids and justified rows. Optional; the 320 px square
              // `thumbnail` stays the required one.
              type: z.enum(["thumbnail", "optimised", "thumbnail_lg"]),
              fileType: z.enum(["image", "video"]),
              dir: z.string(),
              name: z.string(), // e.g. `${base}__thumb.avif`
              mime: z.string(),
              size: z.number().int().nonnegative(),
              quality: z.number().int().min(1).max(100).optional(),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .mutation(async ({ input }) => {
      const { originalFileId, variants } = input;

      const result: {
        originalFileId: string;
        thumbnail: null | { id: string; dir: string; name: string };
        optimised: null | { id: string; dir: string; name: string };
        thumbnail_lg: null | { id: string; dir: string; name: string };
      } = { originalFileId, thumbnail: null, optimised: null, thumbnail_lg: null };

      // The file became a RAW companion while the worker encoded it: a
      // companion has no variants, so it can never show on its own. Remove
      // what the worker just wrote, and the RAW preview it may have cached.
      if (isRawCompanion(originalFileId)) {
        for (const v of variants) {
          try {
            await fs.promises.unlink(await resolveAssetPath(path.resolve(path.join(v.dir, v.name))));
          } catch {
            // Best-effort: already gone.
          }
        }
        await deleteRawPreviews([originalFileId]);
        return result;
      }

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

        // Sent to every connected user, so no file id: a viewer must not
        // learn the id of a file hidden from them. The web only refetches.
        wsManager.broadcast("file:variant-saved", { variantType: v.type });
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
          inArray(FileVariantTable.type, [
            "thumbnail",
            "optimised",
            THUMBNAIL_LG,
          ]),
        ),
      );

    const thumbnail = variants.find((v) => v.type === "thumbnail") ?? null;
    const optimized = variants.find((v) => v.type === "optimised") ?? null;
    const thumbnailLg =
      variants.find((v) => v.type === "thumbnail_lg") ?? null;

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
      thumbnailLg: thumbnailLg
        ? { id: thumbnailLg.id, quality: thumbnailLg.quality }
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
      // Reads only the denormalized file.taken_at (no image_metadata join), so
      // the scan is a covering range on file_taken_at_idx. taken_at is always
      // a toISOString() value, so substr(taken_at, 1, 7) is the 'YYYY-MM'
      // bucket: one cheap group key instead of two strftime() calls per row.
      const bucket = sql`substr(${FileTable.takenAt}, 1, 7)`;

      const months = await db
        .select({
          year: sql<number>`cast(substr(${FileTable.takenAt}, 1, 4) as integer)`,
          month: sql<number>`cast(substr(${FileTable.takenAt}, 6, 2) as integer)`,
          count: sql<number>`count(*)`,
        })
        .from(FileTable)
        .where(
          and(
            buildFileAccessFilter(accessScope, FileTable.id),
            ...(input.kind === "all" ? [] : [eq(FileTable.type, input.kind)]),
            isNotNull(FileTable.takenAt),
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
        .groupBy(bucket)
        .orderBy(desc(bucket));

      const total = months.reduce((sum, m) => sum + m.count, 0);
      return { months, total };
    }),

  // ---- Bulk actions for the grid selection bar -----------------------------

  // Users that files can be shared with (non-admins other than the caller).
  // Only people who can share (an admin, or a user who owns a library) may
  // list the users; only an admin sees their email addresses.
  shareTargets: privateProcedure.query(async ({ ctx: { userId, session } }) => {
    if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
    const scope = await getAccessScope(userId, session);
    if (!scope.isAdmin && scope.ownedLibraryIds.size === 0) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    const rows = await db
      .select({ id: UserTable.id, name: UserTable.name, email: UserTable.email })
      .from(UserTable)
      .where(ne(UserTable.type, "admin"));
    return rows
      .filter((u) => u.id !== userId)
      .map((u) => ({ id: u.id, name: u.name, email: scope.isAdmin ? u.email : null }));
  }),

  // Share (or stop sharing) many files with many users. Only files the caller
  // can manage are touched (an admin manages all; a user manages files in
  // their own libraries). Existing shares to other users are kept.
  bulkShare: privateProcedure
    .input(
      z.object({
        fileIds: z.array(z.string()).min(1).max(BULK_MAX),
        userIds: z.array(z.string()).min(1).max(200),
        mode: z.enum(["add", "remove"]),
      }),
    )
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const fileIds = await manageableFileIds(
        userId,
        session,
        [...new Set(input.fileIds)],
      );
      const targets = await nonAdminUserIds([...new Set(input.userIds)]);
      if (targets.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No valid users" });
      }

      for (const ids of chunk(fileIds, 400)) {
        const match = and(
          eq(SharedItemTable.sourceType, "file"),
          inArray(SharedItemTable.sourceId, ids),
          eq(SharedItemTable.shareType, "user"),
          inArray(SharedItemTable.sharedToUserId, targets),
        );
        if (input.mode === "remove") {
          await db.delete(SharedItemTable).where(match);
          continue;
        }
        const existing = await db
          .select({
            fileId: SharedItemTable.sourceId,
            userId: SharedItemTable.sharedToUserId,
          })
          .from(SharedItemTable)
          .where(match);
        const have = new Set(existing.map((e) => `${e.fileId}|${e.userId}`));
        const rows: (typeof SharedItemTable.$inferInsert)[] = [];
        for (const fileId of ids) {
          for (const to of targets) {
            if (have.has(`${fileId}|${to}`)) continue;
            rows.push({
              sourceType: "file",
              sourceId: fileId,
              shareType: "user",
              accessLevel: "view",
              sharedToUserId: to,
            });
          }
        }
        for (const part of chunk(rows, 500)) {
          await db.insert(SharedItemTable).values(part);
        }
      }
      for (const id of targets) clearScopeCache(id);
      return {
        count: fileIds.length,
        skipped: input.fileIds.length - fileIds.length,
      };
    }),

  // Admin: hide (or unhide) many files from many viewers.
  bulkSetHidden: adminProcedure
    .input(
      z.object({
        fileIds: z.array(z.string()).min(1).max(BULK_MAX),
        userIds: z.array(z.string()).min(1).max(200),
        hidden: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const fileIds = [...new Set(input.fileIds)];
      const targets = await nonAdminUserIds([...new Set(input.userIds)]);
      if (targets.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No valid users" });
      }
      for (const ids of chunk(fileIds, 400)) {
        if (input.hidden) {
          const rows = ids.flatMap((fileId) =>
            targets.map((viewerUserId) => ({ viewerUserId, fileId })),
          );
          for (const part of chunk(rows, 500)) {
            await db
              .insert(ViewerHiddenFileTable)
              .values(part)
              .onConflictDoNothing();
          }
        } else {
          await db
            .delete(ViewerHiddenFileTable)
            .where(
              and(
                inArray(ViewerHiddenFileTable.fileId, ids),
                inArray(ViewerHiddenFileTable.viewerUserId, targets),
              ),
            );
        }
      }
      for (const id of targets) clearScopeCache(id);
      return { count: fileIds.length };
    }),

  // Start a zip download of many files. Returns a one-time token for
  // GET /download/:token (see server.ts). Files the caller cannot see are
  // dropped silently, the same as a missing file.
  createDownload: privateProcedure
    .input(z.object({ fileIds: z.array(z.string()).min(1).max(BULK_MAX) }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const ids = [...new Set(input.fileIds)];
      const allowed: string[] = [];
      for (const id of ids) {
        if (await canUserViewFile(userId, session, id)) allowed.push(id);
      }
      if (allowed.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nothing to download" });
      }
      return {
        token: createDownloadTicket(userId, allowed),
        count: allowed.length,
      };
    }),

  // Admin: queue the 640 px grid thumbnail for images that do not have one
  // yet. Safe to run again; it only touches files that still miss it.
  backfillLargeThumbnails: adminProcedure.mutation(async () => ({
    queued: await backfillLargeThumbnails(),
  })),
});

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function nonAdminUserIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: UserTable.id })
    .from(UserTable)
    .where(and(inArray(UserTable.id, ids), ne(UserTable.type, "admin")));
  return rows.map((r) => r.id);
}

// The subset of fileIds the caller may share: all for an admin, else the ones
// in a library the caller owns (same rule as canUserManageSharedItem).
async function manageableFileIds(
  userId: string,
  session: { user?: { type?: string } } | null,
  fileIds: string[],
): Promise<string[]> {
  if (isAdminSession(session)) return fileIds;
  const out: string[] = [];
  for (const ids of chunk(fileIds, 400)) {
    const rows = await db
      .selectDistinct({ fileId: LibraryFileTable.fileId })
      .from(LibraryFileTable)
      .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
      .where(
        and(
          inArray(LibraryFileTable.fileId, ids),
          isNull(LibraryFileTable.deletedAt),
          eq(LibraryTable.userId, userId),
        ),
      );
    out.push(...rows.map((r) => r.fileId));
  }
  return out;
}

/**
 * Queue the 640 px `thumbnail_lg` variant for every image that has the 320 px
 * thumbnail but not the large one, by setting its `encode_thumbnail` task back
 * to pending. The worker sees thumbnail + optimised already present and only
 * renders the large thumbnail, from the optimised variant (no read of the
 * original). Idempotent: files that have the variant, SVGs, and files whose
 * encode was skipped as undecodable are left alone. Returns how many it queued.
 */
export async function backfillLargeThumbnails(): Promise<number> {
  const rows = await db
    .select({ id: FileTable.id })
    .from(FileTable)
    .where(
      and(
        eq(FileTable.type, "image"),
        ne(FileTable.mime, "image/svg+xml"),
        exists(
          db
            .select({ one: sql`1` })
            .from(FileVariantTable)
            .where(
              and(
                eq(FileVariantTable.originalFileId, FileTable.id),
                eq(FileVariantTable.type, "thumbnail"),
              ),
            ),
        ),
        sql`NOT EXISTS (SELECT 1 FROM ${FileVariantTable} WHERE ${FileVariantTable.originalFileId} = ${FileTable.id} AND ${FileVariantTable.type} = 'thumbnail_lg')`,
        sql`NOT EXISTS (SELECT 1 FROM ${FileTaskTable} WHERE ${FileTaskTable.fileId} = ${FileTable.id} AND ${FileTaskTable.type} = 'encode_thumbnail' AND ${FileTaskTable.status} IN ('skipped', 'pending', 'in_progress'))`,
      ),
    );

  const ids = rows.map((r) => r.id);
  // The encode lease takes the oldest updatedAt first. Stamp the backfill a
  // day ahead so photos imported today are not stuck behind a large backlog.
  const now = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  for (const part of chunk(ids, 500)) {
    await db
      .insert(FileTaskTable)
      .values(
        part.map((fileId) => ({
          fileId,
          type: "encode_thumbnail" as const,
          status: "pending" as const,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [FileTaskTable.fileId, FileTaskTable.type, FileTaskTable.version],
        set: { status: "pending", attempts: 0, lastError: null, updatedAt: now },
      });
  }
  return ids.length;
}

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
      width: ImageMetadataTable.width,
      height: ImageMetadataTable.height,
      sortAt: sortExpr,
    })
    // CROSS JOIN (join condition in WHERE) pins file as the outer loop, so the
    // page is a walk down file_gallery_sort_idx that stops after limit+1 rows.
    // With an INNER JOIN the plan depends on sqlite_stat1, and with the stats
    // prod has the planner scans all of image_metadata and sorts it instead
    // (30-45 ms vs 0.5 ms for page 1 on a 21k-photo library).
    .from(FileTable)
    .crossJoin(ImageMetadataTable)
    .where(
      and(
        eq(ImageMetadataTable.fileId, FileTable.id),
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
    hasRaw: hasRawOf(r.file),
    blurhash: r.blurhash,
    takenAt: r.takenAt,
    width: r.width,
    height: r.height,
    sortAt: r.sortAt,
  }));

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  const last = items[items.length - 1];
  // Encode the full keyset (sortAt + id) so the next page resumes deterministically.
  const nextCursor = hasMore && last ? `${last.sortAt}|${last.id}` : null;
  return { items, nextCursor } as const;
};
