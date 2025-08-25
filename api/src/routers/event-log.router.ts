import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { EventLogTable } from "../db/schema.js";

export const eventLogRouter = router({
  log: internalProcedure
    .input(
      z.object({
        userId: z.uuid(),
        type: z.string(),
        message: z.string(),
        extra: z.object().optional(),
      }),
    )
    .mutation(({ input: { message, extra, type, userId } }) => {
      return db
        .insert(EventLogTable)
        .values([{ userId, message, extra, type }]);
    }),
});
