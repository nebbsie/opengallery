CREATE TABLE `person_merge_dismissed` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`person_id_low` text NOT NULL,
	`person_id_high` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_merge_dismissed_pair_uidx` ON `person_merge_dismissed` (`person_id_low`,`person_id_high`);--> statement-breakpoint
CREATE INDEX `person_merge_dismissed_library_idx` ON `person_merge_dismissed` (`library_id`);
