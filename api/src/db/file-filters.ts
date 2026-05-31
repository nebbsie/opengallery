import { eq, notInArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "./index.js";
import { FaceTable, PersonTable } from "./schema.js";

// Content visibility filter: a person can be hidden (admin-only), which removes
// every photo that contains them from the browse surfaces — global gallery,
// timeline, map and prev/next navigation. Album and direct-link access are left
// untouched by design.
//
// Hiding is a rare, privileged action, so the common path is "nobody is hidden".
// We exploit that: callers first check anyHiddenPeople() (one tiny indexed
// lookup) and only add the per-row exclusion when something is actually hidden,
// keeping the hot gallery query a clean indexed keyset scan in the normal case.

// True when at least one person is currently hidden.
export async function anyHiddenPeople(): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(PersonTable)
    .where(eq(PersonTable.hidden, true))
    .limit(1);
  return !!row;
}

// Excludes any file that contains a face linked to a hidden person.
//
// Implemented as NOT IN (set of hidden-person file ids) rather than a correlated
// NOT EXISTS: hidden people are rare so the set is small, and materializing it
// once + probing is far cheaper than re-running the subquery per candidate row
// (measured ~2x faster on the gallery/timeline). face.file_id is NOT NULL, so
// there's no NOT-IN-with-NULL pitfall.
export function hiddenPersonExclusion(fileIdColumn: SQLiteColumn): SQL {
  return notInArray(
    fileIdColumn,
    db
      .select({ fileId: FaceTable.fileId })
      .from(FaceTable)
      .innerJoin(PersonTable, eq(PersonTable.id, FaceTable.personId))
      .where(eq(PersonTable.hidden, true)),
  );
}

// Returns the exclusion SQL when there are hidden people, else undefined so it
// can be spread straight into a drizzle `and(...)`.
export async function hiddenPeopleFilter(
  fileIdColumn: SQLiteColumn,
): Promise<SQL | undefined> {
  return (await anyHiddenPeople())
    ? hiddenPersonExclusion(fileIdColumn)
    : undefined;
}
