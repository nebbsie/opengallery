import { internalProcedure, router, strictPrivateProcedure } from "../trpc.js";
import { z } from "zod";
import { MediaPathTable, MediaSettingsTable } from "../db/schema.js";
import { db } from "../db/index.js";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";

export const mediaSourcesSettingsRouter = router({
  createSource: strictPrivateProcedure
    .input(z.string().trim().min(1))
    .mutation(async ({ input: path, ctx: { userId } }) => {
      const [createdPath] = await db
        .insert(MediaPathTable)
        .values({ path, userId })
        .returning();
      return createdPath;
    }),

  deleteSource: strictPrivateProcedure
    .input(z.uuid())
    .mutation(async ({ input: pathId, ctx: { userId } }) => {
      return db
        .delete(MediaPathTable)
        .where(
          and(eq(MediaPathTable.id, pathId), eq(MediaPathTable.userId, userId)),
        );
    }),

  updateSettings: strictPrivateProcedure
    .input(z.object({ autoImportAlbums: z.boolean() }))
    .mutation(async ({ input: { autoImportAlbums }, ctx: { userId } }) => {
      return db
        .update(MediaSettingsTable)
        .set({ autoImportAlbums })
        .where(eq(MediaSettingsTable.userId, userId))
        .returning();
    }),

  get: strictPrivateProcedure.query(async ({ ctx: { userId } }) => {
    const [paths, [settings]] = await Promise.all([
      db
        .select()
        .from(MediaPathTable)
        .where(eq(MediaPathTable.userId, userId))
        .orderBy(asc(MediaPathTable.createdAt)),

      db
        .select()
        .from(MediaSettingsTable)
        .where(eq(MediaSettingsTable.userId, userId))
        .limit(1),
    ]);

    if (!settings) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get media settings",
      });
    }

    return { paths, autoImportAlbums: settings.autoImportAlbums };
  }),

  getAll: internalProcedure.query(async () => {
    const [paths, settings] = await Promise.all([
      db.select().from(MediaPathTable).orderBy(asc(MediaPathTable.createdAt)),
      db.select().from(MediaSettingsTable),
    ]);

    const pathsByUser = paths.reduce<Record<string, typeof paths>>((acc, p) => {
      (acc[p.userId] ||= []).push(p);
      return acc;
    }, {});

    return settings.map((setting) => ({
      userId: setting.userId,
      settings: setting,
      paths: pathsByUser[setting.userId] ?? [],
    }));
  }),
});
