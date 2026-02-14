// auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  AuthSchema,
  LibraryTable,
  MediaSettingsTable,
  SystemSettingsTable,
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
        after: async (u) => {
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
            if (!process.env["DEFAULT_UPLOAD_PATH"]) {
              throw new Error(
                "DEFAULT_UPLOAD_PATH is not set in environment variables",
              );
            }

            await db
              .insert(SystemSettingsTable)
              .values({ uploadPath: `${process.env["DEFAULT_UPLOAD_PATH"]}` });
          }

          await db.insert(MediaSettingsTable).values({
            autoImportAlbums: true,
            userId: u.id,
          });
        },
      },
    },
  },

  telemetry: { enabled: false },
  trustedOrigins: parsedOrigins,
  emailAndPassword: { enabled: true },
});
