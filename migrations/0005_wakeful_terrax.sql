ALTER TABLE `file` ADD `taken_at` text;--> statement-breakpoint
UPDATE `file` SET `taken_at` = (SELECT `image_metadata`.`taken_at` FROM `image_metadata` WHERE `image_metadata`.`file_id` = `file`.`id`);--> statement-breakpoint
CREATE INDEX `file_gallery_sort_idx` ON `file` (coalesce(`taken_at`, '0000-01-01T00:00:00.000Z'), `id`);--> statement-breakpoint
CREATE INDEX `file_taken_created_sort_idx` ON `file` (coalesce(`taken_at`, `created_at`), `id`);--> statement-breakpoint
CREATE INDEX `file_taken_at_idx` ON `file` (`taken_at`, `id`);--> statement-breakpoint
CREATE INDEX `person_hidden_idx` ON `person` (`hidden`);
