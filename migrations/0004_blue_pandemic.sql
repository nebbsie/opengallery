DROP INDEX `geo_location_file_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `geo_location_file_id_idx` ON `geo_location` (`file_id`);