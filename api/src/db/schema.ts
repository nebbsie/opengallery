import { relations } from "drizzle-orm";
import {
  boolean,
  decimal,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow();

const id = () => uuid("id").primaryKey().defaultRandom();

export const FileTypeEnum = pgEnum("file_type", ["image", "video"]);
export const SharedItemTypeEnum = pgEnum("shared_item_type", [
  "library",
  "album",
  "file",
]);
export const FileVariantTypeEnum = pgEnum("file_variant_type", [
  "thumbnail",
  "optimised",
]);
export const ShareTypeEnum = pgEnum("share_type", ["user", "public"]);
export const SharedAccessLevelEnum = pgEnum("shared_access_level_type", [
  "view",
  "add",
  "edit",
]);
export const LogEnum = pgEnum("log_type", ["error", "info", "warn", "debug"]);

export const LibraryTable = pgTable("library", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id),
  name: text("name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const FileTable = pgTable(
  "file",
  {
    id: id(),
    dir: text("dir").notNull(),
    name: text("name").notNull(),
    type: FileTypeEnum("type").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("file_path_uidx").on(t.dir, t.name)],
);

export const LibraryFileTable = pgTable("library_file", {
  id: id(),
  libraryId: uuid("library_id")
    .notNull()
    .references(() => LibraryTable.id),
  fileId: uuid("file_id")
    .notNull()
    .references(() => FileTable.id),
  deletedAt: timestamp("deleted_at"),
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
    libraryId: uuid("library_id")
      .notNull()
      .references(() => LibraryTable.id),
    dir: text("dir").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "album_parent_fk", // custom constraint name
    }),
    uniqueIndex("album_library_dir_uidx").on(table.libraryId, table.dir),
  ],
);

export const AlbumRelations = relations(AlbumTable, ({ one, many }) => ({
  parent: one(AlbumTable, {
    fields: [AlbumTable.parentId],
    references: [AlbumTable.id],
  }),
  children: many(AlbumTable),
}));

export const AlbumFileTable = pgTable("album_file", {
  id: id(),
  albumId: uuid("album_id")
    .notNull()
    .references(() => AlbumTable.id),
  fileId: uuid("file_id")
    .notNull()
    .references(() => FileTable.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const SharedItemTable = pgTable("shared_item", {
  id: id(),
  sourceType: SharedItemTypeEnum("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  shareType: ShareTypeEnum("share_type").notNull(),
  accessLevel: SharedAccessLevelEnum("access_level").notNull(),
  sharedToUserId: text("shared_to_user_id").references(() => UserTable.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const FileVariantTable = pgTable(
  "file_variant",
  {
    id: id(),
    type: FileVariantTypeEnum("type").notNull(),
    originalFileId: uuid("original_file_id")
      .notNull()
      .references(() => FileTable.id),
    fileId: uuid("file_id")
      .notNull()
      .references(() => FileTable.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    uniqFileType: uniqueIndex("file_variant_fileid_type_idx").on(
      t.originalFileId,
      t.type,
    ),
  }),
);

export const ImageMetadataTable = pgTable("image_metadata", {
  id: id(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => FileTable.id),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  blurhash: text("blurhash"),
  takenAt: timestamp("taken_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const VideoMetadataTable = pgTable("video_metadata", {
  id: id(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => FileTable.id),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  poster: uuid("poster")
    .notNull()
    .references(() => FileVariantTable.id),
  runtime: integer("runtime").notNull(),
  codec: text("codec"),
  bitrate: integer("bitrate"),
  fps: integer("fps"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const GeoLocationTable = pgTable("geo_location", {
  id: id(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => FileTable.id),
  lat: decimal("lat").notNull(),
  lon: decimal("lon").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const MediaPathTable = pgTable(
  "media_path",
  {
    id: id(),
    path: text("path").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id)
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => {
    return [uniqueIndex().on(table.userId, table.path)];
  },
);

export const MediaSettingsTable = pgTable(
  "media_settings",
  {
    id: id(),
    autoImportAlbums: boolean("auto_import_albums").notNull().default(true),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id)
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => {
    return [uniqueIndex().on(table.userId)];
  },
);

export const SystemSettingsTable = pgTable("system_settings", {
  id: id(),
  uploadPath: text("upload_path").notNull(),
  allowsSelfRegistration: boolean("allows_self_registration")
    .notNull()
    .default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const EventLogTable = pgTable("event_log", {
  id: id(),
  type: text("type").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id)
    .notNull(),
  message: text("message").notNull(),
  extra: jsonb("extra"),
  createdAt: createdAt(),
});

export const userTypeEnum = pgEnum("user_type", ["user", "admin"]);

export const UserTable = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  type: userTypeEnum("type").notNull().default("user"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const SessionTable = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
});

export const AccountTable = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const VerificationTable = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

export const LogTable = pgTable("log", {
  id: id(),
  type: LogEnum("type").notNull(),
  value: text("value").notNull(),
  service: text("service").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
});

export const AuthSchema = {
  user: UserTable,
  session: SessionTable,
  account: AccountTable,
  verification: VerificationTable,
};
