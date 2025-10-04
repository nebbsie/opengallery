import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { GeoLocationTable } from "../db/schema.js";
import { internalProcedure, router } from "../trpc.js";

export const geoLocationRouter = router({
  save: internalProcedure
    .input(
      z.object({
        fileId: z.string(),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await db
        .select()
        .from(GeoLocationTable)
        .where(eq(GeoLocationTable.fileId, input.fileId))
        .limit(1);

      if (existing[0]) {
        const [updated] = await db
          .update(GeoLocationTable)
          .set({ lat: input.lat.toString(), lon: input.lon.toString() })
          .where(eq(GeoLocationTable.fileId, input.fileId))
          .returning();
        return updated;
      }

      const [created] = await db
        .insert(GeoLocationTable)
        .values({
          fileId: input.fileId,
          lat: input.lat.toString(),
          lon: input.lon.toString(),
        })
        .returning();
      return created;
    }),
});
