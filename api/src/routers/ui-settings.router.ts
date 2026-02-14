import { router, strictPrivateProcedure } from "../trpc.js";

export const uiSettingsRouter = router({
  get: strictPrivateProcedure.query(async () => {
    return {};
  }),
});
