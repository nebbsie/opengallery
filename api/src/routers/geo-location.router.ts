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
});
