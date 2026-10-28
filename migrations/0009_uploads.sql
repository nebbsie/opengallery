ALTER TABLE `system_settings` ADD `max_upload_bytes` integer DEFAULT 10737418240 NOT NULL;--> statement-breakpoint
CREATE TABLE `upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`dest_dir` text NOT NULL,
	`part_path` text NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`file_id` text,
	`album_id` text,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `upload_session_user_idx` ON `upload_session` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `upload_session_updated_idx` ON `upload_session` (`updatedAt`);
