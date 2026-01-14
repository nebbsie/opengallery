CREATE INDEX `idx_album_file_album_id` ON `album_file` (`album_id`);--> statement-breakpoint
CREATE INDEX `idx_album_parent_id` ON `album` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_album_created_at` ON `album` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_file_task_status_attempts` ON `file_task` (`status`,`attempts`);--> statement-breakpoint
CREATE INDEX `file_variant_file_id_idx` ON `file_variant` (`file_id`);--> statement-breakpoint
CREATE INDEX `idx_image_metadata_taken_at` ON `image_metadata` (`taken_at`);--> statement-breakpoint
CREATE INDEX `idx_library_file_library_id` ON `library_file` (`library_id`);--> statement-breakpoint
CREATE INDEX `idx_library_file_file_id` ON `library_file` (`file_id`);--> statement-breakpoint
CREATE INDEX `idx_library_file_library_deleted` ON `library_file` (`library_id`,`deleted_at`);