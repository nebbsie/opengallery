import { privateProcedure, publicProcedure, router } from "../trpc.js";

export const mediaLocationsRouter = router({
  create: privateProcedure.query(async (req) => {
    return { status: "ok" };
  }),
});
