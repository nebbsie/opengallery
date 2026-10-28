CREATE TABLE `viewer_hidden_person` (
	`id` text PRIMARY KEY NOT NULL,
	`viewer_user_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `viewer_hidden_person_uidx` ON `viewer_hidden_person` (`viewer_user_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `viewer_hidden_person_person_idx` ON `viewer_hidden_person` (`person_id`);--> statement-breakpoint
CREATE TABLE `viewer_hidden_file` (
	`id` text PRIMARY KEY NOT NULL,
	`viewer_user_id` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `viewer_hidden_file_uidx` ON `viewer_hidden_file` (`viewer_user_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `viewer_hidden_file_file_idx` ON `viewer_hidden_file` (`file_id`);--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`scope` text NOT NULL,
	`album_ids` text DEFAULT '[]' NOT NULL,
	`hidden_person_ids` text DEFAULT '[]' NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by_user_id` text,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_hash_uidx` ON `invite` (`token_hash`);
