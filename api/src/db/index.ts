import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const getDefaultDbPath = () => {
  const dataDir = join(homedir(), ".opengallery");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return join(dataDir, "opengallery.db");
};

const dbPath = process.env["DATABASE_PATH"] || getDefaultDbPath();
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite);
