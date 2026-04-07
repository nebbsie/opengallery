import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const getDefaultDbPath = () => {
  const dataDir = join(homedir(), ".opengallery");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return join(dataDir, "opengallery.db");
};

const dbPath = process.env["DATABASE_PATH"] || getDefaultDbPath();

// Ensure the directory for the database exists
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
export const db = drizzle(sqlite);
