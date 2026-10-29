-- Live Photos: a still's short video is its hidden motion companion
-- (file.motion_file_id on the still, utils/raw-pairing.ts linkMotionPairs).
ALTER TABLE `file` ADD `motion_file_id` text;--> statement-breakpoint
CREATE INDEX `file_motion_file_id_idx` ON `file` (`motion_file_id`);
