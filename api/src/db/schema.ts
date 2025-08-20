import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow();

const id = () => uuid("id").primaryKey().defaultRandom();

export const MediaLocationTable = pgTable("media_location", {
  id: id(),
  location: text("location").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
