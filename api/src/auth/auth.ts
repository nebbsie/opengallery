// auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, sql } from "drizzle-orm";
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
  database: drizzleAdapter(db, { provider: "pg", schema: AuthSchema }),

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
          await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(42)`);
            await tx.execute(sql`
            UPDATE "user"
            SET "type" = 'admin'
            WHERE "id" = ${u.id} AND NOT EXISTS (SELECT 1 FROM "user" WHERE "type" = 'admin')
          `);
          });

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
