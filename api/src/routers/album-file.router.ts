import { db } from "../db/index.js";
import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { AlbumFileTable } from "../db/schema.js";

export const albumFileRouter = router({
  create: privateProcedure
    .input(
      z.array(
        z.object({
          albumId: z.string(),
          fileId: z.string(),
        }),
      ),
    )
    .mutation(({ ctx: { userId }, input }) =>
      db.insert(AlbumFileTable).values(input),
    ),
});
