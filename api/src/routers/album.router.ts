import { db } from "../db/index.js";
import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { AlbumTable } from "../db/schema.js";

export const albumRouter = router({
  create: privateProcedure
    .input(
      z.array(
        z.object({
          name: z.string(),
          libraryId: z.string(),
        }),
      ),
    )
    .mutation(({ ctx: { userId }, input }) =>
      db.insert(AlbumTable).values(input),
    ),

  get: privateProcedure.query(() => db.select().from(AlbumTable)),
});
