import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { MediaSettingsTable, SystemSettingsTable } from "../db/schema.js";

// In-memory caches for the settings rows read on hot paths:
//   - System settings: hit on every encode, lease, and face-match call (the
//     worker polls these in tight loops over HTTP).
//   - Per-user media settings: hit on every gallery/timeline request.
// Cached until explicitly invalidated — there is NO TTL. Every write goes
// through a tRPC mutation in this single API process, and each one invalidates
// (settings.update, mediaSourcesSettings.updateSettings), so the cache can never
// serve a value that is stale relative to a change made through the app. The
// only thing it won't pick up is a direct out-of-band DB edit, which needs a
// restart anyway.
//
// IMPORTANT: any NEW code path that writes system_settings or media_settings
// MUST call the matching invalidate function below.

type SystemSettings = typeof SystemSettingsTable.$inferSelect;
type MediaSettings = typeof MediaSettingsTable.$inferSelect;

// `undefined` = not loaded yet; `null` = loaded, no row exists.
let systemCache: SystemSettings | null | undefined;

export async function getCachedSystemSettings(): Promise<SystemSettings | null> {
  if (systemCache !== undefined) return systemCache;
  const [row] = await db.select().from(SystemSettingsTable).limit(1);
  systemCache = row ?? null;
  return systemCache;
}

export function invalidateSystemSettings(): void {
  systemCache = undefined;
}

const mediaCache = new Map<string, MediaSettings | null>();

export async function getCachedMediaSettings(
  userId: string,
): Promise<MediaSettings | null> {
  if (mediaCache.has(userId)) return mediaCache.get(userId) ?? null;
  const [row] = await db
    .select()
    .from(MediaSettingsTable)
    .where(eq(MediaSettingsTable.userId, userId))
    .limit(1);
  mediaCache.set(userId, row ?? null);
  return row ?? null;
}

export function invalidateMediaSettings(userId: string): void {
  mediaCache.delete(userId);
}
