import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { FileTable } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";

export const filesRouter = router({
  create: privateProcedure
    .input(
      z.array(
        z.object({
          dir: z.string(),
          path: z.string(),
          name: z.string(),
          type: z.enum(["image", "video"]),
          mime: z.string(),
          size: z.number(),
          encoded: z.boolean(),
          fileCreatedAt: z.date(),
        }),
      ),
    )
    .mutation(({ ctx, input }) => db.insert(FileTable).values(input).returning({id: FileTable.id})),

  getFilesInDir: privateProcedure
    .input(z.string())
    .mutation(({ input }) =>
      db.select().from(FileTable).where(eq(FileTable.dir, input)),
    ),

  removeFilesById: privateProcedure
    .input(z.array(z.string()))
    .mutation(({ input }) =>
      db.delete(FileTable).where(inArray(FileTable.id, input)),
    ),

  getAllFiles: privateProcedure.query(() => db.select().from(FileTable)),
});
