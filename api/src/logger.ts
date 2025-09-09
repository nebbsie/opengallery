import { Logger } from "@opengallery/logger";
import { db } from "./db/index.js";
import { LogTable } from "./db/schema.js";

export const logger = new Logger({
  name: "api",
  addToDb: async (type, value, service) => {
    await db.insert(LogTable).values({
      type,
      value: value.trim(),
      service,
    });
  },
});
