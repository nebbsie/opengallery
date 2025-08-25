import { privateProcedure, router } from "../../trpc.js";
import { db } from "../../db/index.js";
import { MediaPathTable, MediaSettingsTable } from "../../db/schema.js";
import { asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const mediaSourcesSettingsRouter = router({
  get: privateProcedure.query(async ({ ctx: { userId } }) => {
    const [paths, settings] = await Promise.all([
      db.select().from(MediaPathTable).orderBy(asc(MediaPathTable.createdAt)),

      db.select().from(MediaSettingsTable),
    ]);

    if (!settings) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get media settings",
      });
    }

    return { paths, settings };
  }),
});
