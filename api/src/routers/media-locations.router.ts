import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";

export const mediaLocationsRouter = router({
  create: privateProcedure.input(z.string()).mutation(async (req) => {
    return { status: "ok" };
  }),
});
