import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  EventLogTable,
  LibraryFileTable,
  LibraryTable,
  MediaPathTable,
  MediaSettingsTable,
  SharedItemTable,
  UiSettingsTable,
  UserTable,
} from "../db/schema.js";
import { privateProcedure, publicProcedure, router } from "../trpc.js";

export const usersRouter = router({
  isFirstSignup: publicProcedure.query(async () => {
    const [res] = await db.select().from(UserTable).limit(1);
    return res === undefined;
  }),

  getAll: privateProcedure.query(async () => {
    const users = await db.select().from(UserTable);
    return users;
  }),

  delete: privateProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Must be authenticated
      const { userId, session } = ctx;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      // Enforce admin-only
      const currentType = session?.user?.type;
      if (currentType !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      // Prevent users from deleting themselves
      if (userId === input.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot delete your own account",
        });
      }

      // Clean up user-scoped settings/data
      await db
        .delete(SharedItemTable)
        .where(eq(SharedItemTable.sharedToUserId, input.id));
      await db
        .delete(MediaPathTable)
        .where(eq(MediaPathTable.userId, input.id));
      await db
        .delete(MediaSettingsTable)
        .where(eq(MediaSettingsTable.userId, input.id));
      await db
        .delete(UiSettingsTable)
        .where(eq(UiSettingsTable.userId, input.id));
      await db.delete(EventLogTable).where(eq(EventLogTable.userId, input.id));

      // Find libraries owned by the user
      const libs = await db
        .select({ id: LibraryTable.id })
        .from(LibraryTable)
        .where(eq(LibraryTable.userId, input.id));
      const libIds = libs.map((l) => l.id);

      if (libIds.length > 0) {
        // Delete albums and their files for these libraries
        const albums = await db
          .select({ id: AlbumTable.id })
          .from(AlbumTable)
          .where(inArray(AlbumTable.libraryId, libIds));
        const albumIds = albums.map((a) => a.id);
        if (albumIds.length > 0) {
          await db
            .delete(AlbumFileTable)
            .where(inArray(AlbumFileTable.albumId, albumIds));
        }
        await db
          .delete(AlbumTable)
          .where(inArray(AlbumTable.libraryId, libIds));

        // Remove library_file links
        await db
          .delete(LibraryFileTable)
          .where(inArray(LibraryFileTable.libraryId, libIds));

        // Finally delete libraries
        await db.delete(LibraryTable).where(inArray(LibraryTable.id, libIds));
      }

      // Delete user (accounts/sessions have ON DELETE CASCADE)
      const [deletedUser] = await db
        .delete(UserTable)
        .where(eq(UserTable.id, input.id))
        .returning();

      if (!deletedUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return deletedUser;
    }),

  // Server-side create that does not affect caller's browser session
  create: privateProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { session } = ctx;
      if (!session?.user?.id) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (session.user.type !== "admin")
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });

      // Call Better Auth server handler without forwarding client cookies, so current session remains
      const base =
        process.env["PUBLIC_URL"] ||
        process.env["API_BASE_URL"] ||
        "http://localhost:3000";
      const url = new URL("/api/auth/sign-up/email", base).toString();

      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // DO NOT FORWARD cookies; ensure admin stays logged in
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          name: input.name,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: text || "Failed to create user",
        });
      }

      // Return created user (Best effort: fetch from DB by email)
      const [user] = await db
        .select()
        .from(UserTable)
        .where(eq(UserTable.email, input.email))
        .limit(1);
      return user ?? null;
    }),
});
