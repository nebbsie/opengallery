import { desc, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { FileTable, ImageMetadataTable } from "./schema.js";

// Sort expressions used by every list of files in the app. Keep these in one
// place so the grid order, album order, camera order and the asset view's
// prev/next navigation can never drift out of sync.
//
// All of these read taken_at from the FILE row (a denormalized copy of
// image_metadata.taken_at) rather than joining image_metadata, so they are
// single-table expressions backed by the file_* sort indexes — see schema.ts.
//
// `fileSortExpr` is for views that fall back to createdAt when takenAt is
// missing (global library, albums). `cameraSortExpr` (below) is for camera
// views, which require takenAt.
export const fileSortExpr = sql<string>`coalesce(${FileTable.takenAt}, ${FileTable.createdAt})`;
// Camera views read image_metadata's own copy of (taken_at, file_id). The
// values equal (file.taken_at, file.id), but these columns are the tail of
// image_metadata_camera_taken_idx (camera_make, camera_model, taken_at,
// file_id), so a camera page or prev/next is an index seek instead of reading
// every photo of that camera and sorting them.
export const cameraSortExpr = sql<string>`${ImageMetadataTable.takenAt}`;
export const cameraIdCol = ImageMetadataTable.fileId;
export const cameraOrderBy = [desc(cameraSortExpr), desc(cameraIdCol)] as const;

// Sentinel sort timestamp for undated media (no takenAt). It is lexicographically
// lower than any real ISO date, so under the newest-first (DESC) order these
// items sink to the very BOTTOM of the global gallery instead of being placed by
// their createdAt. Used only when the user opts to show undated media.
export const UNDATED_SORT_SENTINEL = "0000-01-01T00:00:00.000Z";

// Gallery sort that pins undated media to the bottom. Dated items sort by their
// real takenAt; undated items collapse to the sentinel and then tiebreak by
// files.id DESC via galleryOrderBy.
//
// IMPORTANT: the sentinel is written as an inline SQL literal (not an
// interpolated bound parameter) so this expression matches file_gallery_sort_idx
// exactly — SQLite will not use an expression index when the indexed expression
// contains a literal but the query uses a parameter.
export const undatedBottomSortExpr = sql<string>`coalesce(${FileTable.takenAt}, '0000-01-01T00:00:00.000Z')`;

// Total order: (sortExpr DESC, files.id DESC). Newest first, with id as a
// stable tiebreaker so items with identical sort values have a deterministic
// position both in the grid and in prev/next navigation.
export const galleryOrderBy = (expr: SQL) => [desc(expr), desc(FileTable.id)] as const;

// Keyset comparisons. The leading `expr <= value` / `expr >= value` term is
// redundant for the result, but it is the only part SQLite can use as an index
// range: without it the OR makes the planner scan the sort index from one end
// (through every row before the cursor, and through the ~50k undated variant
// rows for an ASC walk) instead of seeking straight to the cursor.
// `idCol` is the tiebreak column of the same order (FileTable.id by default).

// "Strictly before current in (sortExpr DESC, id DESC) order".
// Use this to find the NEXT visual item (older, right of current in the grid).
export const keysetBefore = (
  expr: SQL | SQLiteColumn,
  sortValue: string,
  id: string,
  idCol: SQLiteColumn = FileTable.id,
): SQL =>
  sql`(${expr} <= ${sortValue} AND (${expr} < ${sortValue} OR (${expr} = ${sortValue} AND ${idCol} < ${id})))`;

// "Strictly after current in (sortExpr DESC, id DESC) order".
// Use this to find the PREVIOUS visual item (newer, left of current in the grid).
export const keysetAfter = (
  expr: SQL | SQLiteColumn,
  sortValue: string,
  id: string,
  idCol: SQLiteColumn = FileTable.id,
): SQL =>
  sql`(${expr} >= ${sortValue} AND (${expr} > ${sortValue} OR (${expr} = ${sortValue} AND ${idCol} > ${id})))`;
