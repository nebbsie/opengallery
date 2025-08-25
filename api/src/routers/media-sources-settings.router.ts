import { privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { MediaPathTable, MediaSettingsTable } from "../db/schema.js";
import { db } from "../db/index.js";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";

export const mediaSourcesSettingsRouter = router({
  createSource: privateProcedure
    .input(z.string().trim().min(1))
    .mutation(async ({ input: path, ctx: { userId } }) => {
      const [createdPath] = await db
        .insert(MediaPathTable)
        .values({ path, userId })
        .returning();
      return createdPath;
    }),

  deleteSource: privateProcedure
    .input(z.string().uuid())
    .mutation(async ({ input: pathId, ctx: { userId } }) => {
      return db
        .delete(MediaPathTable)
        .where(
          and(eq(MediaPathTable.id, pathId), eq(MediaPathTable.userId, userId)),
        );
    }),

  updateSettings: privateProcedure
    .input(z.object({ autoImportAlbums: z.boolean() }))
    .mutation(async ({ input: { autoImportAlbums }, ctx: { userId } }) => {
      await findOrCreateMediaSettings(userId); // ensure row exists
      return db
        .update(MediaSettingsTable)
        .set({ autoImportAlbums })
        .where(eq(MediaSettingsTable.userId, userId))
        .returning();
    }),

  get: privateProcedure.query(async ({ ctx: { userId } }) => {
    const [paths, settings] = await Promise.all([
      db
        .select()
        .from(MediaPathTable)
        .where(eq(MediaPathTable.userId, userId))
        .orderBy(asc(MediaPathTable.createdAt)),

      findOrCreateMediaSettings(userId),
    ]);

    return { paths, autoImportAlbums: settings.autoImportAlbums };
  }),
});

const findOrCreateMediaSettings = async (userId: string) => {
  const [settings] = await db
    .select()
    .from(MediaSettingsTable)
    .where(eq(MediaSettingsTable.userId, userId))
    .limit(1);

  if (settings) return settings;

  const [created] = await db
    .insert(MediaSettingsTable)
    .values({ autoImportAlbums: true, userId })
    .returning();

  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create media settings",
    });
  }
  return created;
};
