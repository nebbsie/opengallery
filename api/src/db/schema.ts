import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  integer, jsonb, foreignKey, decimal
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { relations } from "drizzle-orm";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow();

const id = () => uuid("id").primaryKey().defaultRandom();

//Enums
export const FileTypeEnum = pgEnum("file_type", ["image", "video"]);
export const SharedItemTypeEnum = pgEnum("shared_item_type", ["library", "album", "file"]);
export const FileVariantTypeEnum = pgEnum("file_variant_type", ["thumb", "optimised", "original"]);
export const ShareTypeEnum = pgEnum("share_type", ["user", "public"]);
export const SharedAccessLevelEnum = pgEnum("shared_access_level_type", ["view", "add", "edit"]);

//Tables
export const LibraryTable = pgTable("library", {
  id: id(),
  userId: uuid("uuid").notNull().references(() => user.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const FileTable = pgTable("file", {
  id: id(),
  dir: text("dir").notNull(),
  path: text("path").notNull(),
  name: text("name").notNull(),
  type: FileTypeEnum("type").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  fileCreatedAt: timestamp("file_created_at").notNull(),
  encoded: boolean("encoded").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const LibraryFileTable = pgTable("library_file", {
  id: id(),
  libraryId: uuid("library_id").notNull().references(() => LibraryTable.id),
  fileId: uuid("file_id").notNull().references(() => FileTable.id),
  deletedAt: timestamp("deleted_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const AlbumTable = pgTable(
  "album",
  {
    id: id(),
    name: text("name").notNull(),
    desc: text("desc"),
    cover: uuid("cover").references(() => FileTable.id),
    parentId: uuid("parent_id"),
    libraryId: uuid("library_id").notNull().references(() => LibraryTable.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    //DB-level foreign key (self reference)
    parentFk: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "album_parent_fk", // custom constraint name
    }),
  })
);

// handle the AlbumTable self-reference here
export const AlbumRelations = relations(AlbumTable, ({ one, many }) => ({
  parent: one(AlbumTable, {
    fields: [AlbumTable.parentId],
    references: [AlbumTable.id],
  }),
  children: many(AlbumTable),
}));

export const AlbumFileTable = pgTable("album_file", {
  id: id(),
  albumId: uuid("album_id").notNull().references(() => AlbumTable.id),
  fileId: uuid("file_id").notNull().references(() => FileTable.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const SharedItemTable = pgTable("shared_item", {
  id: id(),
  sourceType: SharedItemTypeEnum("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  shareType: ShareTypeEnum("share_type").notNull(),
  accessLevel: SharedAccessLevelEnum("access_level").notNull(),
  sharedToUserId: uuid("shared_to_user_id").references(() => user.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const FileVariantTable = pgTable("file_variant", {
  id: id(),
  type: FileVariantTypeEnum("type").notNull(),
  fileId: uuid("file_id").notNull().references(() => FileTable.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const ImageMetadataTable = pgTable("image_metadata", {
  id: id(),
  fileId: uuid("file_id").notNull().references(() => FileTable.id),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  blurhash: text("blurhash"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const VideoMetadataTable = pgTable("video_metadata", {
  id: id(),
  fileId: uuid("file_id").notNull().references(() => FileTable.id),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  poster: uuid("poster").notNull().references(() => FileVariantTable.id),
  runtime: integer("runtime").notNull(),
  codec: text("codec"),
  bitrate: integer("bitrate"),
  fps: integer("fps"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const GeoLocationTable = pgTable("geo_location", {
  id: id(),
  fileId: uuid("file_id").notNull().references(() => FileTable.id),
  lat: decimal("lat").notNull(),
  lon: decimal("lon").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const MediaPathTable = pgTable("media_path", {
  id: id(),
  path: text("path").notNull(),
  userId: uuid("user_id").references(() => user.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const MediaSettingsTable = pgTable("media_settings", {
  id: id(),
  autoImportAlbums: boolean("auto_import_albums").notNull().default(true),
  userId: uuid("user_id").references(() => user.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const EventLogTable = pgTable("event_log", {
  id: id(),
  type: text("type").notNull(),
  userId: uuid("user_id").references(() => user.id),
  message: text("message").notNull(),
  extra: jsonb("extra"),
  createdAt: createdAt(),
});
