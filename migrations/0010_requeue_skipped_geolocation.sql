-- GPS extraction skipped every video before the format-tag fix (and Samsung's
-- location-eng tag was not read at all). Skipped is terminal, so run all
-- skipped GPS tasks once more; files with no GPS simply skip again (cheap:
-- it reads only EXIF / ffprobe tags).
UPDATE `file_task` SET `status` = 'pending', `attempts` = 0, `started_at` = NULL, `finished_at` = NULL, `last_error` = NULL WHERE `type` = 'extract_geolocation' AND `status` = 'skipped';
