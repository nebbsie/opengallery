import { z } from "zod";
import { db } from "../db/index.js";
import { SystemSettingsTable } from "../db/schema.js";
import { privateProcedure, publicProcedure, router } from "../trpc.js";

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
        encodingConcurrency: z.optional(z.number().int().min(1).max(64)),
      })
    )
    .mutation(async (ctx) => {
      const [res] = await db
        .update(SystemSettingsTable)
        .set(ctx.input)
        .returning();

      return res;
    }),
});
