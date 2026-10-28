-- Query performance indexes, measured on a copy of the prod DB (Oct 2026).
-- Hand-written: drizzle-kit mangles partial and expression index DDL.
--
-- file_task: file_task_type_status_idx (type, status) replaces
-- file_task_status_idx (status); it covers the polled (type, status) counts.
-- file_task_queue_idx holds only leasable rows, in lease order per type. Its
-- WHERE must stay word for word the same as taskQueued in
-- api/src/utils/task-queue.ts, or SQLite stops using it.
-- file_task_file_id_idx duplicates the leading column of file_task_unique.
DROP INDEX IF EXISTS `file_task_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `file_task_file_id_idx`;--> statement-breakpoint
CREATE INDEX `file_task_type_status_idx` ON `file_task` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `file_task_queue_idx` ON `file_task` (`type`,`updatedAt`,`file_id`) WHERE status IN ('pending', 'failed') AND attempts < 3;--> statement-breakpoint
-- Camera grid and camera prev/next: seek by camera, ordered by taken_at.
DROP INDEX IF EXISTS `image_metadata_camera_idx`;--> statement-breakpoint
CREATE INDEX `image_metadata_camera_taken_idx` ON `image_metadata` (`camera_make`,`camera_model`,`taken_at`,`file_id`);--> statement-breakpoint
-- Faces and people: covering and partial indexes, so these reads do not
-- load the ~4 KB face rows (vec blob) or the ~10 KB person centroids.
DROP INDEX IF EXISTS `face_person_id_idx`;--> statement-breakpoint
CREATE INDEX `face_person_idx` ON `face` (`person_id`,`created_at`,`id`,`file_id`);--> statement-breakpoint
CREATE INDEX `face_missing_crop_idx` ON `face` (`id`) WHERE "face"."crop_name" IS NULL;--> statement-breakpoint
CREATE INDEX `face_unclustered_idx` ON `face` (`person_id`,`manual`,`updatedAt`) WHERE "face"."person_id" IS NULL AND "face"."manual" = 0;--> statement-breakpoint
CREATE INDEX `person_list_idx` ON `person` (`library_id`,`hidden`,`face_count`,`name`,`cover_face_id`,`id`);--> statement-breakpoint
-- Full stats for the changed tables. The boot PRAGMA optimize uses
-- analysis_limit=400, which leaves library_file at a sampled "401 rows per
-- library" stat and gives slow plans (full face scan, full library sort).
ANALYZE `file_task`;--> statement-breakpoint
ANALYZE `image_metadata`;--> statement-breakpoint
ANALYZE `face`;--> statement-breakpoint
ANALYZE `person`;--> statement-breakpoint
ANALYZE `library_file`;--> statement-breakpoint
ANALYZE `file`;
