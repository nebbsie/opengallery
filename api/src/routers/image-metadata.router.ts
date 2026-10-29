import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileImportMetaTable, FileTable, ImageMetadataTable } from "../db/schema.js";
import { internalProcedure, router } from "../trpc.js";
import { isMotionCompanion, isRawCompanion } from "../utils/raw-pairing.js";

export const imageMetadataRouter = router({
  save: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        blurhash: z.string().nullable().optional(),
        takenAt: z.coerce.date().nullable().optional(),
        cameraMake: z.string().nullable().optional(),
        cameraModel: z.string().nullable().optional(),
        lensModel: z.string().nullable().optional(),
        iso: z.number().int().nullable().optional(),
        exposureTime: z.string().nullable().optional(),
        focalLength: z.number().nullable().optional(),
        fNumber: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // A RAW or Live Photo motion companion has no metadata (it would show
      // in the gallery).
      if (isRawCompanion(input.fileId) || isMotionCompanion(input.fileId)) return null;
      // No date in the file: use the one an import brought (Takeout JSON).
      const imported = input.takenAt
        ? undefined
        : (
            await db
              .select({ takenAt: FileImportMetaTable.takenAt })
              .from(FileImportMetaTable)
              .where(eq(FileImportMetaTable.fileId, input.fileId))
              .limit(1)
          )[0];
      const values = {
        width: input.width,
        height: input.height,
        blurhash: input.blurhash ?? null,
        takenAt: input.takenAt?.toISOString() ?? imported?.takenAt ?? null,
        cameraMake: input.cameraMake ?? null,
        cameraModel: input.cameraModel ?? null,
        lensModel: input.lensModel ?? null,
        iso: input.iso ?? null,
        exposureTime: input.exposureTime ?? null,
        focalLength:
          input.focalLength != null ? Math.round(input.focalLength) : null,
        fNumber: input.fNumber ?? null,
      };

      const [result] = await db
        .insert(ImageMetadataTable)
        .values({ fileId: input.fileId, ...values })
        .onConflictDoUpdate({
          target: ImageMetadataTable.fileId,
          set: {
            ...values,
            updatedAt: new Date().toISOString(),
          },
        })
        .returning();

      // Keep the denormalized sort key on the file row in sync so the gallery /
      // album / location sorts (coalesce(taken_at, …)) stay indexed. See
      // FileTable.takenAt in schema.ts.
      await db
        .update(FileTable)
        .set({ takenAt: values.takenAt, updatedAt: new Date().toISOString() })
        .where(eq(FileTable.id, input.fileId));

      return result;
    }),
});
