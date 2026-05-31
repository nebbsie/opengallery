import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "./logger.js";

// Per-request DB query stats, so a slow request log can say "took 900ms across
// 47 queries (820ms in SQL)" — which immediately tells you whether a slow page
// is query-bound (N+1, missing index) or CPU/IO-bound elsewhere.
export interface RequestStats {
  queryCount: number;
  queryMs: number;
  slowest: { sql: string; ms: number } | null;
}

const als = new AsyncLocalStorage<RequestStats>();

// Queries at/above this take their own warning line. Tune on prod via env.
const SLOW_QUERY_MS = Number(process.env["SLOW_QUERY_MS"] ?? 100);

// drizzle quotes table identifiers, so the log table appears as "log". Skip it:
// the logger's own writes go through this same instrumented db, and logging a
// slow log-insert would recurse. (event_log is "event_log", so this is exact.)
function isLogTableQuery(sql: string): boolean {
  return sql.includes('"log"');
}

function flatten(sql: string, max = 600): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// Begin a stats scope for the current request. Uses enterWith so every query
// run later in the same async chain (hooks → handler → tRPC procedures) is
// attributed to this request without threading a context object through.
export function beginRequestStats(): RequestStats {
  const store: RequestStats = { queryCount: 0, queryMs: 0, slowest: null };
  als.enterWith(store);
  return store;
}

export function getRequestStats(): RequestStats | undefined {
  return als.getStore();
}

// Called by the db instrumentation after every statement execution.
export function recordQuery(sql: string, ms: number): void {
  if (isLogTableQuery(sql)) return;

  const store = als.getStore();
  if (store) {
    store.queryCount++;
    store.queryMs += ms;
    if (!store.slowest || ms > store.slowest.ms) {
      store.slowest = { sql, ms };
    }
  }

  if (ms >= SLOW_QUERY_MS) {
    logger.warn(`[sql] SLOW QUERY ${ms.toFixed(1)}ms`, { sql: flatten(sql) });
  }
}
