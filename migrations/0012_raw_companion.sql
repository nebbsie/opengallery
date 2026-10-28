-- Camera RAW+JPEG pairs. A RAW file with a JPEG (or other photo) of the same
-- base name in the same folder is stored as a hidden companion of that photo:
-- the photo row points at it. A companion has no library, album, task or
-- derived rows of its own, so it never shows anywhere on its own.
ALTER TABLE `file` ADD `raw_file_id` text;--> statement-breakpoint
CREATE INDEX `file_raw_file_id_idx` ON `file` (`raw_file_id`);
