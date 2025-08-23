import { Logger } from "@opengallery/logger";

export const logger = new Logger({
  logFile:
    process.env["NODE_ENV"] === "production"
      ? "/var/log/opengallery/api.log"
      : undefined,
  name: "api",
});
