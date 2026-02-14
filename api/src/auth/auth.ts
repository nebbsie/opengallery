// auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
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
        },
        after: async (u) => {
          let insertedSystemSettings = false;

          try {
            // SQLite transactions are serialized, so we don't need advisory locks
            // Check if there's already an admin, if not promote this user
            const [existingAdmin] = await db
              .select({ id: UserTable.id })
              .from(UserTable)
              .where(eq(UserTable.type, "admin"))
              .limit(1);

            if (!existingAdmin) {
              await db
                .update(UserTable)
                .set({ type: "admin" })
                .where(eq(UserTable.id, u.id));
            }

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
