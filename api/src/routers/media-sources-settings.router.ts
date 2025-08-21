import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { ApiResponse } from "../types.js";
import { MediaPathTable, MediaSettingsTable } from "../db/schema.js";
import { db } from "../db/index.js";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";

export const mediaSourcesSettingsRouter = router({
  createSource: privateProcedure.input(z.string()).mutation(async (req) => {
    const [createdPath] = await db
      .insert(MediaPathTable)
      .values({
        path: req.input,
      })
      .returning();
    return createdPath;
  }),
  deleteSource: privateProcedure.input(z.uuid()).mutation(async (req) => {
    return db.delete(MediaPathTable).where(eq(MediaPathTable.id, req.input));
  }),
  updateSource: privateProcedure
    .input(
      z.object({
        id: z.uuid(),
        path: z.string(),
      }),
    )
    .mutation(async (req) => {
      return ApiResponse.Ok();
    }),
  updateSettings: privateProcedure
    .input(
      z.object({
        autoImportAlbums: z.boolean(),
      }),
    )
    .mutation(async (req) => {
      return db.update(MediaSettingsTable).set(req.input).returning();
    }),
  get: privateProcedure.query(async () => {
    const paths = await db
      .select()
      .from(MediaPathTable)
      .orderBy(asc(MediaPathTable.createdAt));
    const settings = await findOrCreateMediaSettings();

    return {
      paths,
      autoImportAlbums: settings.autoImportAlbums,
    };
  }),
});

/**
 * Finds or creates media settings in the database.
 *
 * If settings already exist, it returns them.
 * If not, it creates default settings with autoImportAlbums set to true.
 */
const findOrCreateMediaSettings = async () => {
  const [settings] = await db.select().from(MediaSettingsTable).limit(1);

  if (settings) {
    return settings;
  }

  const [createdSettings] = await db
    .insert(MediaSettingsTable)
    .values({ autoImportAlbums: true })
    .returning();

  if (!createdSettings) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Media settings not found.",
    });
  }

  return createdSettings;
};
