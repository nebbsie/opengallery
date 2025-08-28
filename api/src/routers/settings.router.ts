import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  FileTable,
  LibraryFileTable,
  LibraryTable,
  SystemSettingsTable,
} from "../db/schema.js";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { TasksQueue } from "../redis.js";

export const settingsRouter = router({
  get: internalProcedure.query(async () => {
    const [res] = await db.select().from(SystemSettingsTable).limit(1);

    return res;
  }),
});
