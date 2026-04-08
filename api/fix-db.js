import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'db.sqlite');

console.log('Opening database at:', dbPath);
const db = new Database(dbPath);

// Check current schema
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='system_settings'").get();
console.log('Current schema:', schema.sql);

// Check if upload_path has NOT NULL constraint
const columns = db.prepare("PRAGMA table_info(system_settings)").all();
console.log('\nColumns:');
columns.forEach(col => {
  console.log(`  ${col.name}: ${col.type} (notnull: ${col.notnull}, dflt_value: ${col.dflt_value})`);
});

const uploadPathCol = columns.find(c => c.name === 'upload_path');
if (uploadPathCol && uploadPathCol.notnull === 1) {
  console.log('\n⚠️  upload_path has NOT NULL constraint. Fixing...');

  // SQLite doesn't support ALTER TABLE DROP NOT NULL, so we need to recreate the table
  db.exec(`
    -- Create new table with nullable upload_path
    CREATE TABLE system_settings_new (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (uuid()),
      upload_path TEXT,
      variants_path TEXT,
      allows_self_registration INTEGER NOT NULL DEFAULT 0,
      encoding_concurrency INTEGER NOT NULL DEFAULT 2,
      io_concurrency INTEGER NOT NULL DEFAULT 2,
      thumbnail_quality INTEGER NOT NULL DEFAULT 70,
      optimized_quality INTEGER NOT NULL DEFAULT 80,
      gpu_encoding INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Copy data from old table
    INSERT INTO system_settings_new (id, upload_path, variants_path, allows_self_registration, encoding_concurrency, io_concurrency, thumbnail_quality, optimized_quality, gpu_encoding, created_at, updated_at)
    SELECT id, upload_path, variants_path, allows_self_registration, encoding_concurrency, io_concurrency, thumbnail_quality, optimized_quality, gpu_encoding, created_at, updated_at
    FROM system_settings;

    -- Drop old table
    DROP TABLE system_settings;

    -- Rename new table
    ALTER TABLE system_settings_new RENAME TO system_settings;

    -- Recreate indexes if needed
    CREATE INDEX IF NOT EXISTS idx_system_settings_id ON system_settings(id);
  `);

  console.log('✅ Fixed! upload_path is now nullable.');

  // Verify fix
  const newColumns = db.prepare("PRAGMA table_info(system_settings)").all();
  const newUploadPathCol = newColumns.find(c => c.name === 'upload_path');
  console.log('\nNew schema:');
  newColumns.forEach(col => {
    console.log(`  ${col.name}: ${col.type} (notnull: ${col.notnull}, dflt_value: ${col.dflt_value})`);
  });
} else {
  console.log('\n✅ upload_path is already nullable or not found.');
}

db.close();
console.log('\nDone!');
