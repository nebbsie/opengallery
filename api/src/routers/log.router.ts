import { and, desc, inArray, ne, or, sql } from "drizzle-orm";
import z from "zod";
import { db } from "../db/index.js";
import { LogTable } from "../db/schema.js";
import { internalProcedure, privateProcedure, router } from "../trpc.js";

export const logRouter = router({
  get: privateProcedure
    .input(
      z.object({
        types: z.array(z.enum(["error", "info", "warn", "debug"])).optional(),
        service: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().int().positive().max(1000).default(200),
      })
    )
    .query(({ input }) => {
      const i = input;
      const conditions: any[] = [];
      if (i.types && i.types.length > 0) {
        conditions.push(inArray(LogTable.type, i.types as any));
      } else {
        conditions.push(ne(LogTable.type, "debug"));
      }
      if (i.service) {
        conditions.push(sql`${LogTable.service} = ${i.service}`);
      }
      if (i.search && i.search.trim() !== "") {
        const q = `%${i.search.toLowerCase()}%`;
        conditions.push(
          or(
            sql`lower(${LogTable.value}) like ${q}`,
            sql`lower(${LogTable.service}) like ${q}`
          )
        );
      }
      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;
      return db
        .select()
        .from(LogTable)
        .where(whereClause as any)
        .orderBy(desc(LogTable.createdAt))
        .limit(i.limit ?? 200);
    }),

  create: internalProcedure
    .input(
      z.object({
        type: z.enum(["error", "info", "warn", "debug"]),
        value: z.string(),
        service: z.string(),
      })
    )
    .mutation(({ input }) => {
      return db
        .insert(LogTable)
        .values([
          { type: input.type, value: input.value, service: input.service },
        ]);
    }),
});
