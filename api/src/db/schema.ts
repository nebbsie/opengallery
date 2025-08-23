import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow();

const id = () => uuid("id").primaryKey().defaultRandom();

export const FileTypeEnum = pgEnum("file_type", ["image", "video"]);

export const MediaPathTable = pgTable("media_path", {
  id: id(),
  path: text("path").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const MediaSettingsTable = pgTable("media_settings", {
  autoImportAlbums: boolean("auto_import_albums").notNull().default(true),
});

export const FileTable = pgTable("file", {
  id: id(),
  path: text("path").notNull(),
  type: FileTypeEnum("type").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
