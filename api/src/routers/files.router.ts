import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";

export const filesRouter = router({
  create: privateProcedure
    .input(
      z.object({
        path: z.string(),
        name: z.string(),
        type: z.enum(["image", "video"]),
        mime: z.string(),
        size: z.number(),
      }),
    )
    .mutation(({ ctx, input }) => {
      console.log("Creating directory with input:", input);
    }),
});
