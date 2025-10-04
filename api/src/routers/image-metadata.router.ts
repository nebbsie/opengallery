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
        })
        .returning();
      return created;
    }),
});
