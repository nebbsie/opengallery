CREATE INDEX `library_file_library_deleted_idx` ON `library_file` (`library_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `library_user_id_idx` ON `library` (`user_id`);