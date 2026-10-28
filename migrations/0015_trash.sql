CREATE TABLE `trash_item` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`original_path` text NOT NULL,
	`trash_path` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`file_count` integer DEFAULT 1 NOT NULL,
	`deleted_by` text,
	`created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `trash_item_created_idx` ON `trash_item` (`created_at`);
