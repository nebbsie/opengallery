// auth.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  AccountTable,
  AuthSchema,
  LibraryTable,
  MediaSettingsTable,
  SessionTable,
  SystemSettingsTable,
  UiSettingsTable,
  UserTable,
} from "../db/schema.js";
import {
  getCachedSystemSettings,
  invalidateSystemSettings,
} from "../utils/settings-cache.js";

// Set while an admin creates a user (users.create), so the sign-up hook lets
// the request through even when self-registration is turned off.
const adminSignup = new AsyncLocalStorage<boolean>();

export function runAsAdminSignup<T>(fn: () => Promise<T>): Promise<T> {
  return adminSignup.run(true, fn);
}

const rawOrigins = process.env["TRUSTED_ORIGINS"];

const parsedOrigins = rawOrigins
  ? rawOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : ["*"];

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema: AuthSchema }),

  // keep role/type server-controlled
  user: {
    additionalFields: {
      type: {
        type: "string",
        input: false,
        defaultValue: "user",
        required: true,
      },
    },
  },

  // promote first user to admin atomically
  databaseHooks: {
    user: {
      create: {
        before: async () => {
          const [existingUser] = await db
            .select({ id: UserTable.id })
            .from(UserTable)
            .limit(1);

          if (!existingUser && !process.env["STORAGE_PATH"]) {
            throw new Error("STORAGE_PATH is not set in environment variables");
          }

          // The register page hides itself when self-registration is off, but
          // the sign-up endpoint is public, so enforce the setting here too.
          // The first user can always sign up (they become the admin).
          if (existingUser && !adminSignup.getStore()) {
            const settings = await getCachedSystemSettings();
            if (!settings?.allowsSelfRegistration) {
              throw new APIError("FORBIDDEN", {
                message: "Self-registration is disabled",
              });
            }
          }
        },
        after: async (u) => {
          let insertedSystemSettings = false;

          try {
            // Promote this user only if there is no admin yet. One statement,
            // so two concurrent first sign-ups cannot both become admin (a
            // separate select + update could interleave across awaits).
            await db
              .update(UserTable)
              .set({ type: "admin" })
              .where(
                and(
                  eq(UserTable.id, u.id),
                  sql`NOT EXISTS (SELECT 1 FROM "user" WHERE "type" = 'admin')`,
                ),
              );

            await db.insert(LibraryTable).values({ userId: u.id });

            const [user] = await db
              .select()
              .from(UserTable)
              .where(eq(UserTable.id, u.id))
              .limit(1);

            if (user?.type === "admin") {
              await db
                .insert(SystemSettingsTable)
                .values({
                  uploadPath: `${process.env["STORAGE_PATH"]}/uploads`,
                  variantsPath: `${process.env["STORAGE_PATH"]}/variants`,
                });
              insertedSystemSettings = true;
              // The register page may have cached "no settings row" already.
              invalidateSystemSettings();
            }

            await db.insert(MediaSettingsTable).values({
              autoImportAlbums: true,
              userId: u.id,
            });
          } catch (error) {
            await db.transaction(async (tx) => {
              await tx.delete(SessionTable).where(eq(SessionTable.userId, u.id));
              await tx.delete(AccountTable).where(eq(AccountTable.userId, u.id));
              await tx.delete(UiSettingsTable).where(eq(UiSettingsTable.userId, u.id));
              await tx.delete(MediaSettingsTable).where(eq(MediaSettingsTable.userId, u.id));
              await tx.delete(LibraryTable).where(eq(LibraryTable.userId, u.id));
              if (insertedSystemSettings) {
                await tx.delete(SystemSettingsTable);
              }
              await tx.delete(UserTable).where(eq(UserTable.id, u.id));
            });
            if (insertedSystemSettings) invalidateSystemSettings();

            throw error;
          }
        },
      },
    },
  },

  telemetry: { enabled: false },
  trustedOrigins: parsedOrigins,
  emailAndPassword: { enabled: true },
});
