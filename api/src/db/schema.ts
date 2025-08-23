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
  dir: text("dir").notNull(), // Directory path. Not including name of file.
  path: text("path").notNull(), // Full path including name of file.
  name: text("name").notNull(), // Name of file only.
  type: FileTypeEnum("type").notNull(), // "image" | "video"
  mime: text("mime").notNull(), // MIME type, e.g. "image/jpeg"
  size: integer("size").notNull(), // Size in bytes
  createdAt: createdAt(), // When the record was created
  updatedAt: updatedAt(), // When the record was last updated
});
