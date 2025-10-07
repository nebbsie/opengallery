import { internalProcedure, router, strictPrivateProcedure } from "../trpc.js";
import { z } from "zod";
import { MediaPathTable } from "../db/schema.js";
import { db } from "../db/index.js";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";

export const mediaPathRouter = router({
  get: strictPrivateProcedure.query(async ({ ctx: { userId } }) => {
    const [paths] = await Promise.all([
      db
        .select()
        .from(MediaPathTable)
        .where(eq(MediaPathTable.userId, userId))
        .orderBy(asc(MediaPathTable.createdAt)),
    ]);

    if (!paths) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get media paths",
      });
    }

    return { paths };
  }),
});
