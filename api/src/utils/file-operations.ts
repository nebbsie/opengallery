import { and, eq, exists, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  AlbumFileTable,
  AlbumTable,
  FaceTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
  GeoLocationTable,
  ImageMetadataTable,
  LibraryFileTable,
  PersonTable,
  VideoMetadataTable,
} from '../db/schema.js';

export async function deleteFilesWithCascade(fileIds: string[]) {
  if (!fileIds.length) return [];

  const idsToDelete = Array.from(new Set([...fileIds]));

  const variantRows = await db
    .select({ fileId: FileVariantTable.fileId })
    .from(FileVariantTable)
    .where(inArray(FileVariantTable.originalFileId, fileIds));

  const variantFileIds = variantRows.map((r) => r.fileId);
  idsToDelete.push(...variantFileIds);

  await db
    .update(AlbumTable)
    .set({ cover: null })
    .where(inArray(AlbumTable.cover, idsToDelete));

  await db
    .delete(VideoMetadataTable)
    .where(inArray(VideoMetadataTable.fileId, idsToDelete));

  await db
    .delete(ImageMetadataTable)
    .where(inArray(ImageMetadataTable.fileId, idsToDelete));

  await db
    .delete(GeoLocationTable)
    .where(inArray(GeoLocationTable.fileId, idsToDelete));

  // Remove detected faces for these files, then clean up the person clusters
  // they belonged to: recompute counts, drop now-empty clusters, and repair any
  // cover that pointed at a deleted face.
  const affectedFaces = await db
    .select({ personId: FaceTable.personId })
    .from(FaceTable)
    .where(inArray(FaceTable.fileId, idsToDelete));
  const affectedPersonIds = Array.from(
    new Set(affectedFaces.map((r) => r.personId).filter((p): p is string => !!p)),
  );

  await db.delete(FaceTable).where(inArray(FaceTable.fileId, idsToDelete));

  for (const personId of affectedPersonIds) {
    const remaining = await db
      .select({ id: FaceTable.id })
      .from(FaceTable)
      .where(eq(FaceTable.personId, personId));
    if (remaining.length === 0) {
      await db.delete(PersonTable).where(eq(PersonTable.id, personId));
      continue;
    }
    const [person] = await db
      .select({ coverFaceId: PersonTable.coverFaceId })
      .from(PersonTable)
      .where(eq(PersonTable.id, personId))
      .limit(1);
    const coverStillValid =
      !!person?.coverFaceId && remaining.some((r) => r.id === person.coverFaceId);
    await db
      .update(PersonTable)
      .set({
        faceCount: remaining.length,
        ...(coverStillValid ? {} : { coverFaceId: remaining[0]!.id }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(PersonTable.id, personId));
  }

  await db
    .delete(AlbumFileTable)
    .where(inArray(AlbumFileTable.fileId, idsToDelete));

  await db
    .delete(LibraryFileTable)
    .where(inArray(LibraryFileTable.fileId, idsToDelete));

  await db
    .delete(FileTaskTable)
    .where(inArray(FileTaskTable.fileId, idsToDelete));

  await db
    .delete(FileVariantTable)
    .where(
      or(
        inArray(FileVariantTable.originalFileId, idsToDelete),
        inArray(FileVariantTable.fileId, idsToDelete)
      )
    );

  const result = await db
    .delete(FileTable)
    .where(inArray(FileTable.id, idsToDelete))
    .returning({ id: FileTable.id });

  return result;
}

export async function computeAlbumCovers(
  albumIds: string[]
): Promise<Record<string, string | null>> {
  const coverByAlbum: Record<string, string | null> = {};

  const albumsWithCovers = await db
    .select({ id: AlbumTable.id, cover: AlbumTable.cover })
    .from(AlbumTable)
    .where(inArray(AlbumTable.id, albumIds));

  const albumsNeedingCover: string[] = [];
  for (const album of albumsWithCovers) {
    if (album.cover) {
      coverByAlbum[album.id] = album.cover;
    } else {
      albumsNeedingCover.push(album.id);
    }
  }

  if (albumsNeedingCover.length > 0) {
    const computedCovers = await db
      .select({
        albumId: AlbumFileTable.albumId,
        fileId: sql<string>`MIN(${FileTable.id})`,
      })
      .from(AlbumFileTable)
      .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
      .where(
        and(
          inArray(AlbumFileTable.albumId, albumsNeedingCover),
          eq(FileTable.type, 'image'),
          exists(
            db
              .select()
              .from(FileVariantTable)
              .where(
                and(
                  eq(FileVariantTable.originalFileId, FileTable.id),
                  eq(FileVariantTable.type, 'thumbnail')
                )
              )
          )
        )
      )
      .groupBy(AlbumFileTable.albumId);

    for (const { albumId, fileId } of computedCovers) {
      coverByAlbum[albumId] = fileId;
    }

    for (const albumId of albumsNeedingCover) {
      if (!(albumId in coverByAlbum)) {
        coverByAlbum[albumId] = null;
      }
    }
  }

  return coverByAlbum;
}
