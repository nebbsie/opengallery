import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow();

const id = () => uuid("id").primaryKey().defaultRandom();

export const MediaPathTable = pgTable("media_path", {
  id: id(),
  path: text("path").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const MediaSettingsTable = pgTable("media_settings", {
  autoImportAlbums: boolean("auto_import_albums").notNull().default(true),
});
