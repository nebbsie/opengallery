import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.js";
import { authSchema } from "../db/auth-schema.js";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  trustedOrigins: ["http://localhost:3000", 'http://localhost:4200"'],
  emailAndPassword: {
    enabled: true,
  },
});
