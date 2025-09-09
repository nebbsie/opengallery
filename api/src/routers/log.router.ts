import { db } from "../db/index.js";
import { LogTable } from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { desc, ne } from "drizzle-orm";
import z from "zod";

export const logRouter = router({
  get: privateProcedure.query(() =>
    db
      .select()
      .from(LogTable)
      .where(ne(LogTable.type, "debug"))
      .orderBy(desc(LogTable.createdAt)),
  ),

  create: internalProcedure
    .input(
      z.object({
        type: z.enum(["error", "info", "warn", "debug"]),
        value: z.string(),
        service: z.string(),
      }),
    )
    .mutation(({ input }) => {
      return db
        .insert(LogTable)
        .values([
          { type: input.type, value: input.value, service: input.service },
        ]);
    }),
});
