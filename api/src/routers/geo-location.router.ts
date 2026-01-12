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
        lat: z.number(),
        lon: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      // Skip invalid coordinates (malformed EXIF GPS data)
      if (
        input.lat < -90 ||
        input.lat > 90 ||
        input.lon < -180 ||
        input.lon > 180
      ) {
        return null;
      }

      const existing = await db
        .select()
        .from(GeoLocationTable)
        .where(eq(GeoLocationTable.fileId, input.fileId))
        .limit(1);

      if (existing[0]) {
        const [updated] = await db
          .update(GeoLocationTable)
          .set({ lat: input.lat, lon: input.lon })
          .where(eq(GeoLocationTable.fileId, input.fileId))
          .returning();
        return updated;
      }

      const [created] = await db
        .insert(GeoLocationTable)
        .values({
          fileId: input.fileId,
          lat: input.lat,
          lon: input.lon,
        })
        .returning();
      return created;
    }),
});
