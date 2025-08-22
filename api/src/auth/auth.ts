// auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import { authSchema, user } from "../db/auth-schema.js";
import { sql, eq } from "drizzle-orm";

const trustedOrigins = process.env["TRUSTED_ORIGIN"]
  ? [process.env["TRUSTED_ORIGIN"]]
  : ["http://localhost:4200"];

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),

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
        },
      },
    },
  },

  telemetry: { enabled: false },
  trustedOrigins,
  emailAndPassword: { enabled: true },
});
