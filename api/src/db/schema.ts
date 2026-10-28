import { randomUUID } from "crypto";
import { relations, sql } from "drizzle-orm";
import {
  blob,
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
// thumbnail_lg: 640px uncropped thumbnail for retina grids (srcset).
export type FileVariantType = "thumbnail" | "optimised" | "thumbnail_lg";
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
  | "extract_geolocation"
  // Image-text embedding for object search ("red car"), see api/src/clip.
  | "embed_clip";
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
    // Camera RAW+JPEG pair: the RAW file (same base name, same folder) of this
    // photo. The RAW row is a hidden companion: it has no library, album, task
    // or derived rows, so it never shows on its own. Plain text, no FK, like
    // the other links here; kept in sync by utils/raw-pairing.ts.
    rawFileId: text("raw_file_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("file_path_uidx").on(t.dir, t.name),
    index("file_raw_file_id_idx").on(t.rawFileId),
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
    // Camera list, camera grid and camera prev/next: (make, model) groups in
    // index order, and (taken_at, file_id) is the camera sort order, so a
    // page or a neighbour is an index seek. Replaces image_metadata_camera_idx
    // (its prefix).
    index("image_metadata_camera_taken_idx").on(
      t.cameraMake,
      t.cameraModel,
      t.takenAt,
      t.fileId,
    ),
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
    // Set once a user has curated this person (named it, merged into it, or put
    // faces on it). Faces of a pinned person are fixed anchors when faces are
    // regrouped, so a regroup never undoes the user's work.
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("person_library_id_idx").on(t.libraryId),
    // Supports the anyHiddenPeople() short-circuit and the hidden-person photo
    // exclusion filter applied across the browse queries.
    index("person_hidden_idx").on(t.hidden),
    // Covers listPeople / listPeoplePage. The row itself holds the ~10 KB JSON
    // centroid in overflow pages before face_count, so a table read costs
    // about 3 pages per person.
    index("person_list_idx").on(t.libraryId, t.hidden, t.faceCount, t.name, t.coverFaceId, t.id),
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
    // Null = detected but not in any group yet (an unclustered face).
    personId: text("person_id").references(() => PersonTable.id),
    // Legacy JSON number[] embedding (pre-"vec" rows). New rows use vec.
    embedding: text("embedding"),
    // L2-normalized Float32 embedding as raw little-endian bytes.
    vec: blob("vec", { mode: "buffer" }),
    // Recognition model that produced vec. Embeddings from different models
    // are never compared.
    model: text("model"),
    // 0..1 face quality (size, sharpness, pose, detector score). Low-quality
    // faces never start a group on their own.
    quality: real("quality"),
    // Head turn from the 5 landmarks: 0 = frontal, about 1 = full profile.
    yaw: real("yaw"),
    // Drawn by a user, not found by the detector. Kept across rescans.
    manual: integer("manual", { mode: "boolean" }).notNull().default(false),
    // A user said this face is this person. Kept across rescans and regroups.
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
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
    // Covers "faces of a person" reads that need no vector (merge, delete,
    // getPersonFiles, clashes, newest-first lists): a face row is about one
    // 4 KB page because of the vec blob.
    index("face_person_idx").on(t.personId, t.createdAt, t.id, t.fileId),
    // Faces with no avatar crop: the worker's crop backfill reads this
    // instead of every face row.
    index("face_missing_crop_idx").on(t.id).where(sql`${t.cropName} IS NULL`),
    // Unclustered detected faces: faces.status and the auto-regroup timer.
    index("face_unclustered_idx")
      .on(t.personId, t.manual, t.updatedAt)
      .where(sql`${t.personId} IS NULL AND ${t.manual} = 0`),
  ],
);

// One image-text (CLIP-style) embedding per photo or video, for object search
// ("red car", "teapot"). A text query is embedded by the same model and the
// photos are ranked by cosine similarity (api/src/clip).
export const FileEmbeddingTable = sqliteTable(
  "file_embedding",
  {
    fileId: text("file_id").primaryKey(),
    // Model that produced vec; embeddings from different models never mix.
    model: text("model").notNull(),
    // L2-normalized Float32 vector as raw little-endian bytes.
    vec: blob("vec", { mode: "buffer" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("file_embedding_model_idx").on(t.model)],
);

// "This face is not that person": a user answer. Regrouping and live matching
// never put the face back on that person. Survives rescans because a rescanned
// face keeps its row id when its box overlaps the old one.
export const FaceRejectionTable = sqliteTable(
  "face_rejection",
  {
    id: id(),
    faceId: text("face_id").notNull(),
    personId: text("person_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("face_rejection_uidx").on(t.faceId, t.personId),
    index("face_rejection_person_idx").on(t.personId),
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
  // When faces were last regrouped (faces/recluster.ts).
  faceLastReclusterAt: text("face_last_recluster_at"),
  // Largest file one upload may be (bytes). See uploads/upload-store.ts.
  maxUploadBytes: integer("max_upload_bytes").notNull().default(10737418240),
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
    // Also serves file_id lookups (leading column), so no separate file_id index.
    uniqueIndex("file_task_unique").on(t.fileId, t.type, t.version),
    // (type, status) counts, stale-lease requeue, backfills, retries.
    index("file_task_type_status_idx").on(t.type, t.status),
    // Leasable rows only, in lease order per type (migration 0014). The WHERE
    // must match taskQueued (utils/task-queue.ts) word for word.
    index("file_task_queue_idx")
      .on(t.type, t.updatedAt, t.fileId)
      .where(sql`status IN ('pending', 'failed') AND attempts < 3`),
  ],
);

export const AuthSchema = {
  user: UserTable,
  session: SessionTable,
  account: AccountTable,
  verification: VerificationTable,
};

// Per-viewer content rules. A row hides a person (every file with a face of
// that person) or a single file from one non-admin viewer, everywhere: lists,
// counts, covers, people, direct links. Applied through getAccessScope /
// buildFileAccessFilter. No FKs (foreign keys are not enforced here); rows are
// cleaned up when the user, person or file is deleted, and moved on merge.
export const ViewerHiddenPersonTable = sqliteTable(
  "viewer_hidden_person",
  {
    id: id(),
    viewerUserId: text("viewer_user_id").notNull(),
    personId: text("person_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("viewer_hidden_person_uidx").on(t.viewerUserId, t.personId),
    index("viewer_hidden_person_person_idx").on(t.personId),
  ],
);

export const ViewerHiddenFileTable = sqliteTable(
  "viewer_hidden_file",
  {
    id: id(),
    viewerUserId: text("viewer_user_id").notNull(),
    fileId: text("file_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("viewer_hidden_file_uidx").on(t.viewerUserId, t.fileId),
    index("viewer_hidden_file_file_idx").on(t.fileId),
  ],
);

export type InviteScope = "library" | "albums";

// Single-use sign-up link created by an admin. Only the SHA-256 of the token is
// stored. The presets (what the new user can see) are applied in one
// transaction when the invite is accepted.
export const InviteTable = sqliteTable(
  "invite",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    scope: text("scope").$type<InviteScope>().notNull(),
    albumIds: text("album_ids").notNull().default("[]"), // JSON string[]
    hiddenPersonIds: text("hidden_person_ids").notNull().default("[]"), // JSON string[]
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    usedByUserId: text("used_by_user_id"),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invite_token_hash_uidx").on(t.tokenHash)],
);

export type UploadSessionStatus = "open" | "done" | "duplicate" | "cancelled";

// One resumable upload (uploads/upload-store.ts). Chunks are appended to
// part_path; `received` is the byte count on disk, so a client resumes from it
// after a dropped connection. dest_dir is the absolute album folder inside the
// user's uploads folder.
export const UploadSessionTable = sqliteTable(
  "upload_session",
  {
    id: id(),
    userId: text("user_id").notNull(),
    fileName: text("file_name").notNull(),
    size: integer("size").notNull(),
    mime: text("mime").notNull(),
    destDir: text("dest_dir").notNull(),
    partPath: text("part_path").notNull(),
    received: integer("received").notNull().default(0),
    status: text("status").$type<UploadSessionStatus>().notNull().default("open"),
    fileId: text("file_id"),
    albumId: text("album_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("upload_session_user_idx").on(t.userId, t.status),
    index("upload_session_updated_idx").on(t.updatedAt),
  ],
);

export type TrashItemKind = "file" | "folder";

// A file or folder the user deleted in the UI (utils/media-trash.ts). The
// original was moved into a hidden ".trash" folder next to it, so it can be
// restored until the trash is emptied. Paths are the real paths in this
// process (after MEDIA_PATH_MAP); `name` and `originalPath` are for display.
export const TrashItemTable = sqliteTable(
  "trash_item",
  {
    id: id(),
    kind: text("kind").$type<TrashItemKind>().notNull(),
    name: text("name").notNull(),
    originalPath: text("original_path").notNull(),
    trashPath: text("trash_path").notNull(),
    size: integer("size").notNull().default(0),
    fileCount: integer("file_count").notNull().default(1),
    deletedBy: text("deleted_by"),
    createdAt: createdAt(),
  },
  (t) => [index("trash_item_created_idx").on(t.createdAt)],
);
