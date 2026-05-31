CREATE TABLE `face` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`person_id` text,
	`embedding` text NOT NULL,
	`box_x` real NOT NULL,
	`box_y` real NOT NULL,
	`box_w` real NOT NULL,
	`box_h` real NOT NULL,
	`det_score` real,
	`crop_dir` text,
	`crop_name` text,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `face_file_id_idx` ON `face` (`file_id`);--> statement-breakpoint
CREATE INDEX `face_person_id_idx` ON `face` (`person_id`);--> statement-breakpoint
CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`name` text,
	`cover_face_id` text,
	`centroid` text,
	`face_count` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `person_library_id_idx` ON `person` (`library_id`);--> statement-breakpoint
ALTER TABLE `system_settings` ADD `face_concurrency` integer DEFAULT 2 NOT NULL;