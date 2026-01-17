import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { ImageMetadataTable } from "../db/schema.js";
import { internalProcedure, router } from "../trpc.js";

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
      const values = {
        width: input.width,
        height: input.height,
        blurhash: input.blurhash ?? null,
        takenAt: input.takenAt?.toISOString() ?? null,
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

      return result;
    }),
});
