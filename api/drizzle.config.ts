import "dotenv/config";

export default {
  out: "./drizzle",
  schema: ["./src/db/schema.ts"],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
};
