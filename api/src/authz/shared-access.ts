import {
  type SQL,
  and,
  eq,
  exists,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  FaceTable,
  LibraryFileTable,
  LibraryTable,
  SharedItemTable,
  type SharedItemType,
  ViewerHiddenFileTable,
  ViewerHiddenPersonTable,
} from "../db/schema.js";

export type SessionLike = {
  user?: {
    id?: string;
    type?: string;
  };
} | null;

export type AccessScope = {
  isAdmin: boolean;
  userId: string;
  visibleAlbumIds: Set<string>;
  recursiveAlbumIds: Set<string>;
  accessibleLibraryIds: Set<string>;
  directFileIds: Set<string>;
  ownedLibraryIds: Set<string>;
  // Per-viewer rules (always empty for admins). A hidden person removes every
  // file with a face of that person; a hidden file removes that file. Both
  // win over any share.
  hiddenPersonIds: Set<string>;
  hiddenFileIds: Set<string>;
};

export const isAdminSession = (session: SessionLike) =>
  session?.user?.type === "admin";

type CacheEntry = { scope: AccessScope; expires: number };
const scopeCache = new Map<string, CacheEntry>();
const SCOPE_TTL_MS = 60_000;

export function clearScopeCache(userId?: string): void {
  if (userId) {
    scopeCache.delete(`${userId}:0`);
    scopeCache.delete(`${userId}:1`);
  } else {
    scopeCache.clear();
  }
}

export async function getAccessScope(
  userId: string,
  session: SessionLike,
): Promise<AccessScope> {
  const isAdmin = isAdminSession(session);
  const cacheKey = `${userId}:${isAdmin ? "1" : "0"}`;
  const cached = scopeCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.scope;
  }

  if (isAdmin) {
    const [libraries, albums] = await Promise.all([
      db.select({ id: LibraryTable.id }).from(LibraryTable),
      db.select({ id: AlbumTable.id }).from(AlbumTable),
    ]);

    const scope: AccessScope = {
      isAdmin,
      userId,
      ownedLibraryIds: new Set(libraries.map((row) => row.id)),
      accessibleLibraryIds: new Set(libraries.map((row) => row.id)),
      visibleAlbumIds: new Set(albums.map((row) => row.id)),
      recursiveAlbumIds: new Set(albums.map((row) => row.id)),
      directFileIds: new Set<string>(),
      hiddenPersonIds: new Set<string>(),
      hiddenFileIds: new Set<string>(),
    };
    scopeCache.set(cacheKey, { scope, expires: Date.now() + SCOPE_TTL_MS });
    return scope;
  }

  const [ownedLibraries, sharedItems, hiddenPeople, hiddenFiles] = await Promise.all([
    db
      .select({ id: LibraryTable.id })
      .from(LibraryTable)
      .where(eq(LibraryTable.userId, userId)),
    db
      .select({
        sourceType: SharedItemTable.sourceType,
        sourceId: SharedItemTable.sourceId,
      })
      .from(SharedItemTable)
      .where(
        and(
          eq(SharedItemTable.shareType, "user"),
          eq(SharedItemTable.accessLevel, "view"),
          eq(SharedItemTable.sharedToUserId, userId),
        ),
      ),
    db
      .select({ personId: ViewerHiddenPersonTable.personId })
      .from(ViewerHiddenPersonTable)
      .where(eq(ViewerHiddenPersonTable.viewerUserId, userId)),
    db
      .select({ fileId: ViewerHiddenFileTable.fileId })
      .from(ViewerHiddenFileTable)
      .where(eq(ViewerHiddenFileTable.viewerUserId, userId)),
  ]);

  const ownedLibraryIds = new Set(ownedLibraries.map((row) => row.id));
  const accessibleLibraryIds = new Set(ownedLibraries.map((row) => row.id));
  const recursiveAlbumIds = new Set<string>();
  const visibleAlbumIds = new Set<string>();
  const directFileIds = new Set<string>();
  const sharedAlbumRootIds: string[] = [];

  for (const item of sharedItems) {
    if (item.sourceType === "library") {
      accessibleLibraryIds.add(item.sourceId);
      continue;
    }

    if (item.sourceType === "album") {
      sharedAlbumRootIds.push(item.sourceId);
      continue;
    }

    if (item.sourceType === "file") {
      directFileIds.add(item.sourceId);
    }
  }

  // Album/file-level shares can reach albums in libraries the user otherwise
  // has no access to (the shared album's subtree, or the ancestor chain of a
  // directly-shared file). Only then do we need the full album graph; in the
  // common case (no album/file shares) every visible album lives in an
  // accessible library, so we load just those. The album_file table — the
  // largest by far — is only consulted to map directly-shared files back to
  // their albums, so we skip it entirely unless there are direct file shares,
  // and scope it to those file IDs when present.
  const needFullAlbumGraph =
    sharedAlbumRootIds.length > 0 || directFileIds.size > 0;

  const [allAlbums, albumFileRows] = await Promise.all([
    needFullAlbumGraph
      ? db
          .select({
            id: AlbumTable.id,
            parentId: AlbumTable.parentId,
            libraryId: AlbumTable.libraryId,
          })
          .from(AlbumTable)
      : accessibleLibraryIds.size > 0
        ? db
            .select({
              id: AlbumTable.id,
              parentId: AlbumTable.parentId,
              libraryId: AlbumTable.libraryId,
            })
            .from(AlbumTable)
            .where(
              inArray(AlbumTable.libraryId, [...accessibleLibraryIds]),
            )
        : Promise.resolve(
            [] as Array<{
              id: string;
              parentId: string | null;
              libraryId: string;
            }>,
          ),
    directFileIds.size > 0
      ? db
          .select({
            albumId: AlbumFileTable.albumId,
            fileId: AlbumFileTable.fileId,
          })
          .from(AlbumFileTable)
          .where(inArray(AlbumFileTable.fileId, [...directFileIds]))
      : Promise.resolve(
          [] as Array<{ albumId: string; fileId: string }>,
        ),
  ]);

  const childrenByParent = new Map<string, string[]>();
  const parentByAlbumId = new Map<string, string | null>();
  const albumIdsByFileId = new Map<string, string[]>();
  for (const album of allAlbums) {
    if (accessibleLibraryIds.has(album.libraryId)) {
      recursiveAlbumIds.add(album.id);
      visibleAlbumIds.add(album.id);
    }

    parentByAlbumId.set(album.id, album.parentId ?? null);

    if (!album.parentId) {
      continue;
    }

    const children = childrenByParent.get(album.parentId) ?? [];
    children.push(album.id);
    childrenByParent.set(album.parentId, children);
  }

  for (const row of albumFileRows) {
    const albumIds = albumIdsByFileId.get(row.fileId) ?? [];
    albumIds.push(row.albumId);
    albumIdsByFileId.set(row.fileId, albumIds);
  }

  const queue = [...sharedAlbumRootIds];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || recursiveAlbumIds.has(currentId)) {
      continue;
    }

    recursiveAlbumIds.add(currentId);
    visibleAlbumIds.add(currentId);
    const children = childrenByParent.get(currentId) ?? [];
    queue.push(...children);
  }

  for (const fileId of directFileIds) {
    const albumIds = albumIdsByFileId.get(fileId) ?? [];
    for (const albumId of albumIds) {
      let currentAlbumId: string | null = albumId;
      while (currentAlbumId) {
        if (visibleAlbumIds.has(currentAlbumId)) {
          currentAlbumId = parentByAlbumId.get(currentAlbumId) ?? null;
          continue;
        }

        visibleAlbumIds.add(currentAlbumId);
        currentAlbumId = parentByAlbumId.get(currentAlbumId) ?? null;
      }
    }
  }

  const scope: AccessScope = {
    isAdmin,
    userId,
    ownedLibraryIds,
    accessibleLibraryIds,
    visibleAlbumIds,
    recursiveAlbumIds,
    directFileIds,
    hiddenPersonIds: new Set(hiddenPeople.map((row) => row.personId)),
    hiddenFileIds: new Set(hiddenFiles.map((row) => row.fileId)),
  };
  await dropFullyHiddenAlbums(scope, childrenByParent);
  scopeCache.set(cacheKey, { scope, expires: Date.now() + SCOPE_TTL_MS });
  return scope;
}

// An album whose whole subtree has photos, but none the viewer may see, would
// show as "0 items" and hint that something is hidden (an album named after
// the hidden person, say). Drop such albums from the viewer's scope, so they
// are not listed and opening one gives the same NOT_FOUND as a missing album.
// Albums that are really empty stay. Runs only when the viewer has rules.
async function dropFullyHiddenAlbums(
  scope: AccessScope,
  childrenByParent: Map<string, string[]>,
): Promise<void> {
  if (scope.hiddenPersonIds.size === 0 && scope.hiddenFileIds.size === 0) return;
  if (scope.visibleAlbumIds.size === 0) return;

  const visibleFilter = buildFileAccessFilter(scope, AlbumFileTable.fileId);
  const rows = await db
    .select({
      albumId: AlbumFileTable.albumId,
      total: sql<number>`count(*)`,
      visible: sql<number>`sum(case when ${visibleFilter} then 1 else 0 end)`,
    })
    .from(AlbumFileTable)
    .where(inArray(AlbumFileTable.albumId, [...scope.visibleAlbumIds]))
    .groupBy(AlbumFileTable.albumId);

  const direct = new Map(rows.map((r) => [r.albumId, r]));
  const memo = new Map<string, { total: number; visible: number }>();
  const rollup = (id: string): { total: number; visible: number } => {
    const hit = memo.get(id);
    if (hit) return hit;
    const own = direct.get(id);
    const acc = { total: Number(own?.total ?? 0), visible: Number(own?.visible ?? 0) };
    memo.set(id, acc);
    for (const child of childrenByParent.get(id) ?? []) {
      if (!scope.visibleAlbumIds.has(child)) continue;
      const c = rollup(child);
      acc.total += c.total;
      acc.visible += c.visible;
    }
    return acc;
  };

  for (const id of [...scope.visibleAlbumIds]) {
    const r = rollup(id);
    if (r.total > 0 && r.visible === 0) {
      scope.visibleAlbumIds.delete(id);
      scope.recursiveAlbumIds.delete(id);
    }
  }
}

/**
 * Build a SQL WHERE condition that filters files by access scope.
 * Uses EXISTS subqueries on library/album membership instead of
 * inArray with a potentially huge set of file IDs (which hits
 * SQLite's 999 variable limit).
 */
export function buildFileAccessFilter(
  scope: AccessScope,
  fileIdColumn: SQLiteColumn,
): SQL {
  if (scope.isAdmin) {
    return sql`1 = 1`;
  }

  const conditions: SQL[] = [];

  // Files accessible via libraries (small number of library IDs)
  if (scope.accessibleLibraryIds.size > 0) {
    conditions.push(
      exists(
        db
          .select({ _: sql`1` })
          .from(LibraryFileTable)
          .where(
            and(
              eq(LibraryFileTable.fileId, fileIdColumn),
              inArray(LibraryFileTable.libraryId, [
                ...scope.accessibleLibraryIds,
              ]),
              isNull(LibraryFileTable.deletedAt),
            ),
          ),
      ),
    );
  }

  // Files accessible via shared albums (moderate number of album IDs)
  if (scope.recursiveAlbumIds.size > 0) {
    conditions.push(
      exists(
        db
          .select({ _: sql`1` })
          .from(AlbumFileTable)
          .where(
            and(
              eq(AlbumFileTable.fileId, fileIdColumn),
              inArray(AlbumFileTable.albumId, [...scope.recursiveAlbumIds]),
            ),
          ),
      ),
    );
  }

  // Directly shared files (typically very small set)
  if (scope.directFileIds.size > 0) {
    conditions.push(inArray(fileIdColumn, [...scope.directFileIds]));
  }

  if (conditions.length === 0) {
    return sql`0 = 1`;
  }

  const access = conditions.length === 1 ? conditions[0]! : or(...conditions)!;
  const exclusions = viewerRuleExclusions(scope, fileIdColumn);
  return exclusions.length > 0 ? and(access, ...exclusions)! : access;
}

// The per-viewer hide rules as NOT IN subqueries (keyed by viewer, so the
// parameter count stays fixed however many people or files are hidden).
function viewerRuleExclusions(
  scope: AccessScope,
  fileIdColumn: SQLiteColumn,
): SQL[] {
  const exclusions: SQL[] = [];
  if (scope.hiddenPersonIds.size > 0) {
    exclusions.push(
      notInArray(
        fileIdColumn,
        db
          .select({ fileId: FaceTable.fileId })
          .from(FaceTable)
          .innerJoin(
            ViewerHiddenPersonTable,
            eq(ViewerHiddenPersonTable.personId, FaceTable.personId),
          )
          .where(eq(ViewerHiddenPersonTable.viewerUserId, scope.userId)),
      ),
    );
  }
  if (scope.hiddenFileIds.size > 0) {
    exclusions.push(
      notInArray(
        fileIdColumn,
        db
          .select({ fileId: ViewerHiddenFileTable.fileId })
          .from(ViewerHiddenFileTable)
          .where(eq(ViewerHiddenFileTable.viewerUserId, scope.userId)),
      ),
    );
  }
  return exclusions;
}

// True when the viewer may not see this person at all (hidden from them).
export function isPersonHiddenFor(scope: AccessScope, personId: string): boolean {
  return scope.hiddenPersonIds.has(personId);
}

// True when a viewer rule hides this file (directly, or through a hidden
// person whose face is in it).
export async function isFileHiddenFor(
  scope: AccessScope,
  fileId: string,
): Promise<boolean> {
  if (scope.isAdmin) return false;
  if (scope.hiddenFileIds.has(fileId)) return true;
  if (scope.hiddenPersonIds.size === 0) return false;
  const [row] = await db
    .select({ id: FaceTable.id })
    .from(FaceTable)
    .where(
      and(
        eq(FaceTable.fileId, fileId),
        inArray(FaceTable.personId, [...scope.hiddenPersonIds]),
      ),
    )
    .limit(1);
  return !!row;
}

export async function canUserViewAlbum(
  userId: string,
  session: SessionLike,
  albumId: string,
): Promise<boolean> {
  const scope = await getAccessScope(userId, session);
  return scope.visibleAlbumIds.has(albumId);
}

export async function canUserViewFile(
  userId: string,
  session: SessionLike,
  fileId: string,
): Promise<boolean> {
  const scope = await getAccessScope(userId, session);
  if (scope.isAdmin) return true;
  if (await isFileHiddenFor(scope, fileId)) return false;
  if (scope.directFileIds.has(fileId)) return true;

  // Check via library membership
  if (scope.accessibleLibraryIds.size > 0) {
    const [row] = await db
      .select({ fileId: LibraryFileTable.fileId })
      .from(LibraryFileTable)
      .where(
        and(
          eq(LibraryFileTable.fileId, fileId),
          inArray(LibraryFileTable.libraryId, [...scope.accessibleLibraryIds]),
          isNull(LibraryFileTable.deletedAt),
        ),
      )
      .limit(1);
    if (row) return true;
  }

  // Check via album membership
  if (scope.recursiveAlbumIds.size > 0) {
    const [row] = await db
      .select({ fileId: AlbumFileTable.fileId })
      .from(AlbumFileTable)
      .where(
        and(
          eq(AlbumFileTable.fileId, fileId),
          inArray(AlbumFileTable.albumId, [...scope.recursiveAlbumIds]),
        ),
      )
      .limit(1);
    if (row) return true;
  }

  return false;
}

export async function getAlbumOwnerUserId(
  albumId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: LibraryTable.userId })
    .from(AlbumTable)
    .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
    .where(eq(AlbumTable.id, albumId))
    .limit(1);

  return row?.userId ?? null;
}

export async function getFileOwnerUserId(
  fileId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: LibraryTable.userId })
    .from(LibraryFileTable)
    .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
    .where(
      and(
        eq(LibraryFileTable.fileId, fileId),
        isNull(LibraryFileTable.deletedAt),
      ),
    )
    .limit(1);

  return row?.userId ?? null;
}

export async function canUserManageSharedItem(
  userId: string,
  session: SessionLike,
  sourceType: SharedItemType,
  sourceId: string,
): Promise<boolean> {
  if (isAdminSession(session)) {
    return true;
  }

  if (sourceType === "album") {
    return (await getAlbumOwnerUserId(sourceId)) === userId;
  }

  if (sourceType === "file") {
    return (await getFileOwnerUserId(sourceId)) === userId;
  }

  const [row] = await db
    .select({ userId: LibraryTable.userId })
    .from(LibraryTable)
    .where(eq(LibraryTable.id, sourceId))
    .limit(1);

  return row?.userId === userId;
}
