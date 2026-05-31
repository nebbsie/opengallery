import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { performance } from "node:perf_hooks";
import { dirname, join } from "path";
import { recordQuery } from "../request-context.js";

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

// Connection tuning for a read-heavy API with a steady stream of small writes
// (the worker flips file_task statuses constantly via tRPC). These run before
// instrument() so the pragma calls themselves aren't timed/logged.
//  - WAL + synchronous=NORMAL: append-only writes, far fewer fsyncs than the
//    default delete-journal + FULL, which stalls the single event loop.
//  - temp_store=MEMORY: ORDER BY / GROUP BY temp b-trees (people list, timeline
//    buckets, …) build in RAM instead of on disk.
//  - mmap + larger page cache: fewer read syscalls and more hot pages resident
//    for a 500MB+ database.
// All but journal_mode are per-connection and set on every startup.
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("temp_store = MEMORY");
sqlite.pragma("cache_size = -131072"); // ~128 MB page cache (negative = KiB)
sqlite.pragma("mmap_size = 268435456"); // 256 MB memory-mapped reads
sqlite.pragma("busy_timeout = 5000");
// Refresh planner stats (capped so it stays cheap at boot) so index choices
// reflect the real data distribution rather than built-in guesses.
sqlite.pragma("analysis_limit = 400");
sqlite.pragma("optimize");

// Time every statement so slow queries (and per-request query totals) get
// logged. better-sqlite3 is synchronous, so we just bracket each terminal call
// (run/get/all/values) with performance.now(). Chainable shapers (pluck/raw/
// expand/bind/safeIntegers) return the statement, so we re-wrap them to keep
// the instrumentation across a chain like stmt.raw().all().
const TIMED_METHODS = new Set(["run", "get", "all", "values"]);

function instrument(database: Database.Database): void {
  const rawPrepare = database.prepare.bind(database);
  database.prepare = ((source: string) => {
    const stmt = rawPrepare(source);
    return new Proxy(stmt, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        if (TIMED_METHODS.has(prop as string)) {
          return (...args: unknown[]) => {
            const start = performance.now();
            try {
              return value.apply(target, args);
            } finally {
              recordQuery(source, performance.now() - start);
            }
          };
        }
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          // Keep the proxy on chainable calls so the timing survives chaining.
          return result === target ? receiver : result;
        };
      },
    });
  }) as typeof database.prepare;
}

instrument(sqlite);

export const db = drizzle(sqlite);
