import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { UiSettingsTable } from "../db/schema.js";
import { router, strictPrivateProcedure } from "../trpc.js";

export const uiSettingsRouter = router({
  get: strictPrivateProcedure.query(async ({ ctx: { userId } }) => {
    let [settings] = await db
      .select()
      .from(UiSettingsTable)
      .where(eq(UiSettingsTable.userId, userId))
      .limit(1);

    if (!settings) {
      const [created] = await db
        .insert(UiSettingsTable)
        .values({ userId, autoCloseSidebarOnAssetOpen: true })
        .returning();
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create UI settings",
        });
      }
      settings = created;
    }

    if (!settings) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get UI settings",
      });
    }

    return {
      autoCloseSidebarOnAssetOpen: settings.autoCloseSidebarOnAssetOpen,
    };
  }),

  update: strictPrivateProcedure
    .input(
      z.object({
        autoCloseSidebarOnAssetOpen: z.boolean(),
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      const [result] = await db
        .insert(UiSettingsTable)
        .values({
          userId,
          autoCloseSidebarOnAssetOpen: input.autoCloseSidebarOnAssetOpen,
        })
        .onConflictDoUpdate({
          target: UiSettingsTable.userId,
          set: {
            autoCloseSidebarOnAssetOpen: input.autoCloseSidebarOnAssetOpen,
          },
        })
        .returning();

      if (!result) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update UI settings",
        });
      }

      return {
        autoCloseSidebarOnAssetOpen: result.autoCloseSidebarOnAssetOpen,
      };
    }),
});
