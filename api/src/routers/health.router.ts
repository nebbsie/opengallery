import { publicProcedure, router } from "../trpc.js";

export const healthRouter = router({
  check: publicProcedure.query(async (req) => {
    return { status: "ok" };
  }),
});
