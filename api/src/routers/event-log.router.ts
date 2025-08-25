import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { EventLogTable } from "../db/schema.js";

export const eventLogRouter = router({
  log: privateProcedure
    .input(
      z.object({
        type: z.string(),
        message: z.string(),
        extra: z.object().optional(),
      }),
    )
    .mutation(({ ctx: { userId }, input: { message, extra, type } }) => {
      return db
        .insert(EventLogTable)
        .values([{ userId, message, extra, type }]);
    }),
});
