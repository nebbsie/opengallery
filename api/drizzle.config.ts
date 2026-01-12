import "dotenv/config";

export default {
  out: "../migrations",
  schema: ["./src/db/schema.ts"],
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH!,
  },
};
