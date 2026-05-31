PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_system_settings` (
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
	`face_concurrency` integer DEFAULT 2 NOT NULL,
	`face_match_threshold` real DEFAULT 0.4 NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_system_settings`("id", "upload_path", "variants_path", "allows_self_registration", "encoding_concurrency", "io_concurrency", "thumbnail_quality", "optimized_quality", "gpu_encoding", "selected_gpu", "face_concurrency", "face_match_threshold", "created_at", "updatedAt") SELECT "id", "upload_path", "variants_path", "allows_self_registration", "encoding_concurrency", "io_concurrency", "thumbnail_quality", "optimized_quality", "gpu_encoding", "selected_gpu", "face_concurrency", "face_match_threshold", "created_at", "updatedAt" FROM `system_settings`;--> statement-breakpoint
DROP TABLE `system_settings`;--> statement-breakpoint
ALTER TABLE `__new_system_settings` RENAME TO `system_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;