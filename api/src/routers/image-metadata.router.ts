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
        takenAt: z.coerce.date().nullable().optional(),
        cameraMake: z.string().nullable().optional(),
        cameraModel: z.string().nullable().optional(),
        lensModel: z.string().nullable().optional(),
        iso: z.number().int().nullable().optional(),
        exposureTime: z.string().nullable().optional(),
        focalLength: z.number().int().nullable().optional(),
        fNumber: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await db
        .select()
        .from(ImageMetadataTable)
        .where(eq(ImageMetadataTable.fileId, input.fileId))
        .limit(1);

      if (existing[0]) {
        const [updated] = await db
          .update(ImageMetadataTable)
          .set({
            width: input.width,
            height: input.height,
            takenAt: input.takenAt ?? null,
            cameraMake: input.cameraMake ?? null,
            cameraModel: input.cameraModel ?? null,
            lensModel: input.lensModel ?? null,
            iso: input.iso ?? null,
            exposureTime: input.exposureTime ?? null,
            focalLength: input.focalLength ?? null,
            fNumber: input.fNumber ?? null,
            updatedAt: new Date(),
          })
          .where(eq(ImageMetadataTable.fileId, input.fileId))
          .returning();
        return updated;
      }

      const [created] = await db
        .insert(ImageMetadataTable)
        .values({
          fileId: input.fileId,
          width: input.width,
          height: input.height,
          takenAt: input.takenAt ?? null,
          cameraMake: input.cameraMake ?? null,
          cameraModel: input.cameraModel ?? null,
          lensModel: input.lensModel ?? null,
          iso: input.iso ?? null,
          exposureTime: input.exposureTime ?? null,
          focalLength: input.focalLength ?? null,
          fNumber: input.fNumber ?? null,
        })
        .returning();
      return created;
    }),
});
