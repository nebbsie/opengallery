-- Face pipeline v2: Float32 embeddings, quality, user answers, unclustered faces.
-- SQLite cannot drop NOT NULL in place, so the face table is rebuilt.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_face` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`person_id` text,
	`embedding` text,
	`vec` blob,
	`model` text,
	`quality` real,
	`yaw` real,
	`manual` integer DEFAULT false NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
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
INSERT INTO `__new_face` (`id`, `file_id`, `person_id`, `embedding`, `model`, `box_x`, `box_y`, `box_w`, `box_h`, `det_score`, `crop_dir`, `crop_name`, `created_at`, `updatedAt`)
SELECT `id`, `file_id`, `person_id`, `embedding`, 'buffalo_l', `box_x`, `box_y`, `box_w`, `box_h`, `det_score`, `crop_dir`, `crop_name`, `created_at`, `updatedAt` FROM `face`;
--> statement-breakpoint
DROP TABLE `face`;--> statement-breakpoint
ALTER TABLE `__new_face` RENAME TO `face`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `face_file_id_idx` ON `face` (`file_id`);--> statement-breakpoint
CREATE INDEX `face_person_id_idx` ON `face` (`person_id`);--> statement-breakpoint
CREATE TABLE `face_rejection` (
	`id` text PRIMARY KEY NOT NULL,
	`face_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `face_rejection_uidx` ON `face_rejection` (`face_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `face_rejection_person_idx` ON `face_rejection` (`person_id`);--> statement-breakpoint
ALTER TABLE `person` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- A named person was curated by a user: keep it fixed when faces are regrouped.
UPDATE `person` SET `pinned` = 1 WHERE `name` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `system_settings` ADD `face_last_recluster_at` text;
--> statement-breakpoint
-- Re-run detection once for every photo and video: faces get embeddings from
-- full-resolution alignment and quality scores. Names and answers are kept
-- (faces/ingest.ts carries each face over by box overlap).
UPDATE `file_task` SET `status` = 'pending', `attempts` = 0, `started_at` = NULL, `finished_at` = NULL, `last_error` = NULL WHERE `type` = 'detect_faces';
