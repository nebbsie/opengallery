-- The CLIP index finds the newest model with ORDER BY updatedAt DESC LIMIT 1,
-- which read the whole file_embedding table (about 1 s cold on prod).
CREATE INDEX `file_embedding_updated_idx` ON `file_embedding` (`updatedAt`);
