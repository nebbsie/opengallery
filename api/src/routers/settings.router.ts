import { privateProcedure, publicProcedure, router } from "../trpc.js";
import { db } from "../db/index.js";
import { SystemSettingsTable } from "../db/schema.js";
import { z } from "zod";

export const settingsRouter = router({
  get: privateProcedure.query(async () => {
    const [res] = await db.select().from(SystemSettingsTable).limit(1);
    return res;
  }),

  allowsSelfRegistration: publicProcedure.query(async () => {
    const [res] = await db.select().from(SystemSettingsTable).limit(1);
    return res?.allowsSelfRegistration ?? false;
  }),

  update: privateProcedure
    .input(
      z.object({
        allowsSelfRegistration: z.optional(z.boolean()),
      }),
    )
    .mutation(async (ctx) => {
      const [res] = await db
        .update(SystemSettingsTable)
        .set(ctx.input)
        .returning();

      return res;
    }),
});
