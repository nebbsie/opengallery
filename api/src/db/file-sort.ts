import { desc, sql, type SQL } from "drizzle-orm";
import { FileTable, ImageMetadataTable } from "./schema.js";

// Sort expressions used by every list of files in the app. Keep these in one
// place so the grid order, album order, camera order and the asset view's
// prev/next navigation can never drift out of sync.
//
// `fileSortExpr` is for views that fall back to createdAt when takenAt is
// missing (global library, albums). `cameraSortExpr` is for camera views
// which require takenAt and therefore use it directly.
export const fileSortExpr = sql<string>`coalesce(${ImageMetadataTable.takenAt}, ${FileTable.createdAt})`;
export const cameraSortExpr = sql<string>`${ImageMetadataTable.takenAt}`;

// Total order: (sortExpr DESC, files.id DESC). Newest first, with id as a
// stable tiebreaker so items with identical sort values have a deterministic
// position both in the grid and in prev/next navigation.
export const galleryOrderBy = (expr: SQL) => [desc(expr), desc(FileTable.id)] as const;

// Keyset comparison: "strictly before current in (sortExpr DESC, id DESC) order".
// Use this to find the NEXT visual item (older, right of current in the grid).
export const keysetBefore = (expr: SQL, sortValue: string, id: string): SQL =>
  sql`(${expr} < ${sortValue} OR (${expr} = ${sortValue} AND ${FileTable.id} < ${id}))`;

// Keyset comparison: "strictly after current in (sortExpr DESC, id DESC) order".
// Use this to find the PREVIOUS visual item (newer, left of current in the grid).
export const keysetAfter = (expr: SQL, sortValue: string, id: string): SQL =>
  sql`(${expr} > ${sortValue} OR (${expr} = ${sortValue} AND ${FileTable.id} > ${id}))`;
