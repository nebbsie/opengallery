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
      // Ensure row exists; create if missing with the provided value
      const [existing] = await db
        .select()
        .from(UiSettingsTable)
        .where(eq(UiSettingsTable.userId, userId))
        .limit(1);

      if (!existing) {
        const [created] = await db
          .insert(UiSettingsTable)
          .values({
            userId,
            autoCloseSidebarOnAssetOpen: input.autoCloseSidebarOnAssetOpen,
          })
          .returning();
        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create UI settings",
          });
        }
        return {
          autoCloseSidebarOnAssetOpen: created.autoCloseSidebarOnAssetOpen,
        };
      }

      const [updated] = await db
        .update(UiSettingsTable)
        .set({
          autoCloseSidebarOnAssetOpen: input.autoCloseSidebarOnAssetOpen,
        })
        .where(eq(UiSettingsTable.userId, userId))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update UI settings",
        });
      }

      return {
        autoCloseSidebarOnAssetOpen: updated.autoCloseSidebarOnAssetOpen,
      };
    }),
});
