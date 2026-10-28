CREATE TABLE `file_import_meta` (
	`file_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`taken_at` text,
	`lat` real,
	`lon` real,
	`description` text,
	`created_at` text NOT NULL
);--> statement-breakpoint
ALTER TABLE `upload_session` ADD `meta` text;
