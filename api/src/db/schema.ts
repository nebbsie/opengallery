import { randomUUID } from "crypto";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

const updatedAt = () =>
  text("updatedAt")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

// SQLite doesn't support enums natively, using text columns with type hints
export type FileType = "image" | "video";
export type SharedItemType = "library" | "album" | "file";
export type FileVariantType = "thumbnail" | "optimised";
export type ShareType = "user" | "public";
export type SharedAccessLevel = "view" | "add" | "edit";
export type LogType = "error" | "info" | "warn" | "debug";
export type ProcessingStage =
  | "import"
  | "encode"
  | "metadata"
  | "geolocation"
  | "variants"
  | "ffmpeg";
export type FileTaskType =
  | "encode_thumbnail"
  | "encode_optimised"
  | "video_poster";
// FileTaskStatusEnum semantics:
// - pending: queued to be processed, not yet started
// - in_progress: worker picked it up and is running
// - succeeded: completed successfully (idempotent; safe to skip next runs)
// - failed: last attempt failed; may be retried based on policy
// - skipped: intentionally not applicable (e.g., unsupported format)
export type FileTaskStatus =
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "skipped";
export type UserType = "user" | "admin";

export const LibraryTable = sqliteTable("library", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id),
  name: text("name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const FileTable = sqliteTable(
  "file",
  {
    id: id(),
    dir: text("dir").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<FileType>().notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    contentHash: text("content_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("file_path_uidx").on(t.dir, t.name)],
);

export const LibraryFileTable = sqliteTable(
  "library_file",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => LibraryTable.id),
    fileId: text("file_id")
      .notNull()
      .references(() => FileTable.id),
    deletedAt: text("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("library_file_library_id_idx").on(t.libraryId),
    index("library_file_file_id_idx").on(t.fileId),
  ],
);

export const AlbumTable = sqliteTable(
  "album",
  {
    id: id(),
    name: text("name").notNull(),
    desc: text("desc"),
    cover: text("cover").references(() => FileTable.id),
    parentId: text("parent_id"),
    libraryId: text("library_id")
      .notNull()
      .references(() => LibraryTable.id),
    dir: text("dir").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
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

export const AlbumFileTable = sqliteTable(
  "album_file",
  {
    id: id(),
    albumId: text("album_id")
      .notNull()
      .references(() => AlbumTable.id),
    fileId: text("file_id")
      .notNull()
      .references(() => FileTable.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("album_file_album_id_idx").on(t.albumId),
    index("album_file_file_id_idx").on(t.fileId),
  ],
);

export const SharedItemTable = sqliteTable("shared_item", {
  id: id(),
  sourceType: text("source_type").$type<SharedItemType>().notNull(),
  sourceId: text("source_id").notNull(),
  shareType: text("share_type").$type<ShareType>().notNull(),
  accessLevel: text("access_level").$type<SharedAccessLevel>().notNull(),
  sharedToUserId: text("shared_to_user_id").references(() => UserTable.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const FileVariantTable = sqliteTable(
  "file_variant",
  {
    id: id(),
    type: text("type").$type<FileVariantType>().notNull(),
    originalFileId: text("original_file_id")
      .notNull()
      .references(() => FileTable.id),
    fileId: text("file_id")
      .notNull()
      .references(() => FileTable.id),
    quality: integer("quality"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("file_variant_fileid_type_idx").on(t.originalFileId, t.type),
    index("file_variant_file_id_idx").on(t.fileId),
  ],
);

export const ImageMetadataTable = sqliteTable(
  "image_metadata",
  {
    id: id(),
    fileId: text("file_id")
      .notNull()
      .references(() => FileTable.id),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    blurhash: text("blurhash"),
    takenAt: text("taken_at"),
    cameraMake: text("camera_make"),
    cameraModel: text("camera_model"),
    lensModel: text("lens_model"),
    iso: integer("iso"),
    exposureTime: text("exposure_time"),
    focalLength: integer("focal_length"),
    fNumber: text("f_number"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("image_metadata_file_id_idx").on(t.fileId),
    index("image_metadata_taken_at_idx").on(t.takenAt),
    index("image_metadata_camera_idx").on(t.cameraMake, t.cameraModel),
  ],
);

export const VideoMetadataTable = sqliteTable("video_metadata", {
  id: id(),
  fileId: text("file_id")
    .notNull()
    .references(() => FileTable.id),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  poster: text("poster")
    .notNull()
    .references(() => FileVariantTable.id),
  runtime: integer("runtime").notNull(),
  codec: text("codec"),
  bitrate: integer("bitrate"),
  fps: integer("fps"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const GeoLocationTable = sqliteTable(
  "geo_location",
  {
    id: id(),
    fileId: text("file_id")
      .notNull()
      .references(() => FileTable.id),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("geo_location_file_id_idx").on(t.fileId)],
);

export const MediaPathTable = sqliteTable(
  "media_path",
  {
    id: id(),
    path: text("path").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("media_path_user_path_uidx").on(table.userId, table.path),
  ],
);

export const MediaSettingsTable = sqliteTable(
  "media_settings",
  {
    id: id(),
    autoImportAlbums: integer("auto_import_albums", { mode: "boolean" })
      .notNull()
      .default(true),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("media_settings_user_uidx").on(table.userId)],
);

export const UiSettingsTable = sqliteTable(
  "ui_settings",
  {
    id: id(),
    autoCloseSidebarOnAssetOpen: integer("auto_close_sidebar_on_asset_open", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("ui_settings_user_uidx").on(table.userId)],
);

export const SystemSettingsTable = sqliteTable("system_settings", {
  id: id(),
  uploadPath: text("upload_path").notNull(),
  variantsPath: text("variants_path"),
  allowsSelfRegistration: integer("allows_self_registration", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  encodingConcurrency: integer("encoding_concurrency").notNull().default(2),
  ioConcurrency: integer("io_concurrency").notNull().default(2),
  thumbnailQuality: integer("thumbnail_quality").notNull().default(70),
  optimizedQuality: integer("optimized_quality").notNull().default(80),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const EventLogTable = sqliteTable("event_log", {
  id: id(),
  type: text("type").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id),
  message: text("message").notNull(),
  extra: text("extra", { mode: "json" }),
  createdAt: createdAt(),
});

export const UserTable = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  type: text("type").$type<UserType>().notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const SessionTable = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id),
});

export const AccountTable = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => UserTable.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const VerificationTable = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
});

export const LogTable = sqliteTable(
  "log",
  {
    id: id(),
    type: text("type").$type<LogType>().notNull(),
    value: text("value").notNull(),
    service: text("service").notNull(),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("log_created_at_idx").on(t.createdAt),
    index("log_service_idx").on(t.service),
  ],
);

export const FileTaskTable = sqliteTable(
  "file_task",
  {
    id: id(),
    fileId: text("file_id")
      .notNull()
      .references(() => FileTable.id),
    type: text("type").$type<FileTaskType>().notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").$type<FileTaskStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    priority: integer("priority").notNull().default(0),
    scheduledAt: text("scheduled_at"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("file_task_unique").on(t.fileId, t.type, t.version),
    index("file_task_status_idx").on(t.status),
    index("file_task_file_id_idx").on(t.fileId),
  ],
);

export const AuthSchema = {
  user: UserTable,
  session: SessionTable,
  account: AccountTable,
  verification: VerificationTable,
};
