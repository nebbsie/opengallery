CREATE TABLE `file_embedding` (
	`file_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`vec` blob NOT NULL,
	`created_at` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_embedding_model_idx` ON `file_embedding` (`model`);
