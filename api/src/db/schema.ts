import { randomUUID } from "crypto";
import { relations, sql } from "drizzle-orm";
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
  | "video_poster"
  | "detect_faces"
  | "extract_geolocation";
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

export const LibraryTable = sqliteTable(
  "library",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => UserTable.id),
    name: text("name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("library_user_id_idx").on(t.userId)],
);

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
    // Denormalized copy of image_metadata.taken_at. The gallery/album/people/
    // location sorts are coalesce(taken_at, created_at) / coalesce(taken_at,
    // <sentinel>); keeping taken_at on the file row makes those single-table
    // expression indexes (below), turning the grid + asset prev/next into
    // indexed keyset scans instead of full scans + filesort. Kept in sync by
    // imageMetadata.save; backfilled by the 0005 migration.
    takenAt: text("taken_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("file_path_uidx").on(t.dir, t.name),
    // Global gallery + asset prev/next: undated media sinks to the sentinel
    // bottom. The sentinel is an inline literal (NOT a bound param) so it
    // matches the ORDER BY expression and SQLite can use this index.
    index("file_gallery_sort_idx").on(
      sql`coalesce(${t.takenAt}, '0000-01-01T00:00:00.000Z')`,
      t.id,
    ),
    // Albums, people, locations: undated falls back to import time.
    index("file_taken_created_sort_idx").on(
      sql`coalesce(${t.takenAt}, ${t.createdAt})`,
      t.id,
    ),
    // Camera view + timeline buckets: order by real capture date.
    index("file_taken_at_idx").on(t.takenAt, t.id),
  ],
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
    index("library_file_library_deleted_idx").on(t.libraryId, t.deletedAt),
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
  // Unique on fileId: one coordinate row per file, and the upsert in
  // geoLocation.save relies on this constraint as its ON CONFLICT target.
  (t) => [uniqueIndex("geo_location_file_id_idx").on(t.fileId)],
);

// A "person" is a cluster of detected faces. name is null until the user
// names the cluster (Google-Photos style). centroid is the running mean of the
// cluster's face embeddings, stored as a JSON float array for fast matching.
export const PersonTable = sqliteTable(
  "person",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => LibraryTable.id),
    name: text("name"),
    // Avatar face for the cluster. Plain text (no FK) to avoid a circular
    // reference with FaceTable; cleaned up in application code.
    coverFaceId: text("cover_face_id"),
    centroid: text("centroid"), // JSON number[] — mean embedding
    faceCount: integer("face_count").notNull().default(0),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("person_library_id_idx").on(t.libraryId),
    // Supports the anyHiddenPeople() short-circuit and the hidden-person photo
    // exclusion filter applied across the browse queries.
    index("person_hidden_idx").on(t.hidden),
  ],
);

// A single detected face within a file, linked to a person cluster.
// Bounding box is normalized 0..1 relative to the source image.
export const FaceTable = sqliteTable(
  "face",
  {
    id: id(),
    fileId: text("file_id")
      .notNull()
      .references(() => FileTable.id),
    personId: text("person_id").references(() => PersonTable.id),
    embedding: text("embedding").notNull(), // JSON number[]
    boxX: real("box_x").notNull(),
    boxY: real("box_y").notNull(),
    boxW: real("box_w").notNull(),
    boxH: real("box_h").notNull(),
    detScore: real("det_score"),
    cropDir: text("crop_dir"),
    cropName: text("crop_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("face_file_id_idx").on(t.fileId),
    index("face_person_id_idx").on(t.personId),
  ],
);

// Pairs of person clusters the user has dismissed as "not the same person", so
// the merge-suggestion query (faces.listMergeSuggestions) stops offering them.
// Stored as a canonical ordered pair (personIdLow < personIdHigh) so a pair is
// dismissed once regardless of which way round it was suggested. No FK to person:
// clusters are deleted on merge, and a dangling dismissal simply never matches a
// live pair — harmless, and proactively cleaned in mergePeople/deletePerson.
export const PersonMergeDismissedTable = sqliteTable(
  "person_merge_dismissed",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => LibraryTable.id),
    personIdLow: text("person_id_low").notNull(),
    personIdHigh: text("person_id_high").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("person_merge_dismissed_pair_uidx").on(
      t.personIdLow,
      t.personIdHigh,
    ),
    index("person_merge_dismissed_library_idx").on(t.libraryId),
  ],
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
    hideUndated: integer("hide_undated", { mode: "boolean" })
      .notNull()
      .default(false),
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
  uploadPath: text("upload_path"),
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
  gpuEncoding: integer("gpu_encoding", { mode: "boolean" }).notNull().default(false),
  selectedGpu: text("selected_gpu"), // Selected GPU for encoding (e.g., 'nvidia:0', 'intel', 'amd')
  faceConcurrency: integer("face_concurrency").notNull().default(2),
  // Cosine-similarity threshold for joining a face to an existing person cluster.
  // Higher = stricter (fewer false merges, more cluster fragmentation). Tunable
  // in Settings → Faces. See assignFace in faces.router.ts.
  faceMatchThreshold: real("face_match_threshold").notNull().default(0.4),
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
    progress: integer("progress").default(0),
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
