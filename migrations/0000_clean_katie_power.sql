CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `album_file` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `album`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `album_file_album_id_idx` ON `album_file` (`album_id`);--> statement-breakpoint
CREATE INDEX `album_file_file_id_idx` ON `album_file` (`file_id`);--> statement-breakpoint
CREATE TABLE `album` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`desc` text,
	`cover` text,
	`parent_id` text,
	`library_id` text NOT NULL,
	`dir` text NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`cover`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `album_library_dir_uidx` ON `album` (`library_id`,`dir`);--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`user_id` text NOT NULL,
	`message` text NOT NULL,
	`extra` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY NOT NULL,
	`dir` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`content_hash` text,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_path_uidx` ON `file` (`dir`,`name`);--> statement-breakpoint
CREATE TABLE `file_task` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`type` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`scheduled_at` text,
	`started_at` text,
	`finished_at` text,
	`last_error` text,
	`progress` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_task_unique` ON `file_task` (`file_id`,`type`,`version`);--> statement-breakpoint
CREATE INDEX `file_task_status_idx` ON `file_task` (`status`);--> statement-breakpoint
CREATE INDEX `file_task_file_id_idx` ON `file_task` (`file_id`);--> statement-breakpoint
CREATE TABLE `file_variant` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`original_file_id` text NOT NULL,
	`file_id` text NOT NULL,
	`quality` integer,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`original_file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_variant_fileid_type_idx` ON `file_variant` (`original_file_id`,`type`);--> statement-breakpoint
CREATE INDEX `file_variant_file_id_idx` ON `file_variant` (`file_id`);--> statement-breakpoint
CREATE TABLE `geo_location` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `geo_location_file_id_idx` ON `geo_location` (`file_id`);--> statement-breakpoint
CREATE TABLE `image_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`blurhash` text,
	`taken_at` text,
	`camera_make` text,
	`camera_model` text,
	`lens_model` text,
	`iso` integer,
	`exposure_time` text,
	`focal_length` integer,
	`f_number` text,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_metadata_file_id_idx` ON `image_metadata` (`file_id`);--> statement-breakpoint
CREATE INDEX `image_metadata_taken_at_idx` ON `image_metadata` (`taken_at`);--> statement-breakpoint
CREATE INDEX `image_metadata_camera_idx` ON `image_metadata` (`camera_make`,`camera_model`);--> statement-breakpoint
CREATE TABLE `library_file` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`file_id` text NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_file_library_id_idx` ON `library_file` (`library_id`);--> statement-breakpoint
CREATE INDEX `library_file_file_id_idx` ON `library_file` (`file_id`);--> statement-breakpoint
CREATE INDEX `library_file_library_deleted_idx` ON `library_file` (`library_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `library` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_user_id_idx` ON `library` (`user_id`);--> statement-breakpoint
CREATE TABLE `log` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`service` text NOT NULL,
	`created_at` text
);
--> statement-breakpoint
CREATE INDEX `log_created_at_idx` ON `log` (`created_at`);--> statement-breakpoint
CREATE INDEX `log_service_idx` ON `log` (`service`);--> statement-breakpoint
CREATE TABLE `media_path` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_path_user_path_uidx` ON `media_path` (`user_id`,`path`);--> statement-breakpoint
CREATE TABLE `media_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`auto_import_albums` integer DEFAULT true NOT NULL,
	`hide_undated` integer DEFAULT false NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_settings_user_uidx` ON `media_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `shared_item` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`share_type` text NOT NULL,
	`access_level` text NOT NULL,
	`shared_to_user_id` text,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`shared_to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_path` text,
	`variants_path` text,
	`allows_self_registration` integer DEFAULT false NOT NULL,
	`encoding_concurrency` integer DEFAULT 2 NOT NULL,
	`io_concurrency` integer DEFAULT 2 NOT NULL,
	`thumbnail_quality` integer DEFAULT 70 NOT NULL,
	`optimized_quality` integer DEFAULT 80 NOT NULL,
	`gpu_encoding` integer DEFAULT false NOT NULL,
	`selected_gpu` text,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ui_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`auto_close_sidebar_on_asset_open` integer DEFAULT true NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ui_settings_user_uidx` ON `ui_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`type` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `video_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`poster` text NOT NULL,
	`runtime` integer NOT NULL,
	`codec` text,
	`bitrate` integer,
	`fps` integer,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`poster`) REFERENCES `file_variant`(`id`) ON UPDATE no action ON DELETE no action
);
