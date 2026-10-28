import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { AlbumTable, LibraryTable, SharedItemTable, UserTable } from "../db/schema.js";

// Collaborative albums: an album shared to a user with access level "add" (or
// "edit") lets that user upload into it, and into its sub-albums. The files go
// into the album's folder and the owner's library.

export type ContribAlbum = { id: string; name: string; dir: string; libraryId: string };

// Album ids shared to the user with add rights (not their sub-albums).
async function addSharedAlbumIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: SharedItemTable.sourceId })
    .from(SharedItemTable)
    .where(
      and(
        eq(SharedItemTable.sourceType, "album"),
        eq(SharedItemTable.shareType, "user"),
        inArray(SharedItemTable.accessLevel, ["add", "edit"]),
        eq(SharedItemTable.sharedToUserId, userId),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

// The album, when the user may add to it through a share on it or on one of
// its parent albums. Null otherwise (also for the user's own albums).
export async function contributableAlbum(userId: string, albumId: string): Promise<ContribAlbum | null> {
  const shared = await addSharedAlbumIds(userId);
  if (shared.size === 0) return null;
  const [album] = await db
    .select({ id: AlbumTable.id, name: AlbumTable.name, dir: AlbumTable.dir, libraryId: AlbumTable.libraryId, parentId: AlbumTable.parentId })
    .from(AlbumTable)
    .where(eq(AlbumTable.id, albumId))
    .limit(1);
  if (!album) return null;
  // Walk up the parents (bounded, in case of a cycle in bad data).
  let cur: { id: string; parentId: string | null } | undefined = album;
  for (let depth = 0; cur && depth < 64; depth++) {
    if (shared.has(cur.id)) {
      return { id: album.id, name: album.name, dir: album.dir, libraryId: album.libraryId };
    }
    if (!cur.parentId) break;
    [cur] = await db
      .select({ id: AlbumTable.id, parentId: AlbumTable.parentId })
      .from(AlbumTable)
      .where(eq(AlbumTable.id, cur.parentId))
      .limit(1);
  }
  return null;
}

// Albums shared to the user with add rights, with the owner's name, for the
// upload dialog. Sub-albums of a shared album are not listed; the user can
// open one and upload from there.
export async function contributableAlbums(
  userId: string,
): Promise<(ContribAlbum & { ownerName: string })[]> {
  const shared = await addSharedAlbumIds(userId);
  if (shared.size === 0) return [];
  return db
    .select({
      id: AlbumTable.id,
      name: AlbumTable.name,
      dir: AlbumTable.dir,
      libraryId: AlbumTable.libraryId,
      ownerName: UserTable.name,
    })
    .from(AlbumTable)
    .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
    .innerJoin(UserTable, eq(UserTable.id, LibraryTable.userId))
    .where(inArray(AlbumTable.id, [...shared]));
}

// An album the user may upload into outside their uploads folder: one of
// their own albums (any folder of their library), or a collaborative album.
export async function uploadableAlbum(userId: string, albumId: string): Promise<ContribAlbum | null> {
  const [own] = await db
    .select({ id: AlbumTable.id, name: AlbumTable.name, dir: AlbumTable.dir, libraryId: AlbumTable.libraryId })
    .from(AlbumTable)
    .innerJoin(LibraryTable, eq(LibraryTable.id, AlbumTable.libraryId))
    .where(and(eq(AlbumTable.id, albumId), eq(LibraryTable.userId, userId)))
    .limit(1);
  return own ?? contributableAlbum(userId, albumId);
}
