import { router } from "../../trpc.js";
import { mediaSourcesSettingsRouter } from "./media-sources-settings.router.js";

export const watcherRouter = router({
  mediaSourcesSettings: mediaSourcesSettingsRouter,
});
