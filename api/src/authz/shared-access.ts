import {
  type SQL,
  and,
  eq,
  exists,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import {
  AlbumFileTable,
  AlbumTable,
  LibraryFileTable,
  LibraryTable,
  SharedItemTable,
  type SharedItemType,
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
};

export const isAdminSession = (session: SessionLike) =>
  session?.user?.type === "admin";

export async function getAccessScope(
  userId: string,
  session: SessionLike,
): Promise<AccessScope> {
  const isAdmin = isAdminSession(session);

  if (isAdmin) {
    const [libraries, albums] = await Promise.all([
      db.select({ id: LibraryTable.id }).from(LibraryTable),
      db.select({ id: AlbumTable.id }).from(AlbumTable),
    ]);

    return {
      isAdmin,
      userId,
      ownedLibraryIds: new Set(libraries.map((row) => row.id)),
      accessibleLibraryIds: new Set(libraries.map((row) => row.id)),
      visibleAlbumIds: new Set(albums.map((row) => row.id)),
      recursiveAlbumIds: new Set(albums.map((row) => row.id)),
      directFileIds: new Set<string>(),
    };
  }

  const [ownedLibraries, sharedItems, allAlbums, albumFileRows] =
    await Promise.all([
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
        .select({
          id: AlbumTable.id,
          parentId: AlbumTable.parentId,
          libraryId: AlbumTable.libraryId,
        })
        .from(AlbumTable),
      db
        .select({
          albumId: AlbumFileTable.albumId,
          fileId: AlbumFileTable.fileId,
        })
        .from(AlbumFileTable),
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

  return {
    isAdmin,
    userId,
    ownedLibraryIds,
    accessibleLibraryIds,
    visibleAlbumIds,
    recursiveAlbumIds,
    directFileIds,
  };
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

  if (conditions.length === 1) return conditions[0]!;
  return or(...conditions)!;
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
