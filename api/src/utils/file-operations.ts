import * as fs from 'node:fs';
import path from 'node:path';
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
import { resolveAssetPath } from './media-path.js';

function parseEmbedding(json: string | null): number[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort unlink of the generated variant files (thumbnails / optimised /
 * posters) produced from the given original files. Each variant is itself a
 * FileTable row, so we resolve its dir/name to an on-disk path the same way the
 * re-encode cleanup and asset routes do. Never touches the user's originals.
 */
export async function deleteVariantFilesFromDisk(
  originalFileIds: string[],
): Promise<void> {
  if (!originalFileIds.length) return;
  const variantFiles = await db
    .select({ dir: FileTable.dir, name: FileTable.name })
    .from(FileVariantTable)
    .innerJoin(FileTable, eq(FileTable.id, FileVariantTable.fileId))
    .where(inArray(FileVariantTable.originalFileId, originalFileIds));

  for (const v of variantFiles) {
    try {
      const abs = await resolveAssetPath(path.resolve(path.join(v.dir, v.name)));
      await fs.promises.unlink(abs);
    } catch {
      // Best-effort: a missing file just means it's already gone.
    }
  }
}

/**
 * Remove all detected faces for the given files and repair the person clusters
 * they belonged to: recompute counts and centroid, drop now-empty clusters,
 * repair a cover that pointed at a removed face, and best-effort unlink the
 * faces' avatar crops from disk. Shared by file deletion (D3), idempotent
 * re-detection (D2), and content-change refresh (D4).
 */
export async function removeFacesForFiles(fileIds: string[]): Promise<void> {
  if (!fileIds.length) return;

  const faces = await db
    .select({
      personId: FaceTable.personId,
      cropDir: FaceTable.cropDir,
      cropName: FaceTable.cropName,
    })
    .from(FaceTable)
    .where(inArray(FaceTable.fileId, fileIds));
  if (faces.length === 0) return;

  const affectedPersonIds = Array.from(
    new Set(faces.map((r) => r.personId).filter((p): p is string => !!p)),
  );

  await db.delete(FaceTable).where(inArray(FaceTable.fileId, fileIds));

  for (const f of faces) {
    if (!f.cropDir || !f.cropName) continue;
    try {
      const abs = await resolveAssetPath(
        path.resolve(path.join(f.cropDir, f.cropName)),
      );
      await fs.promises.unlink(abs);
    } catch {
      // Best-effort: already gone.
    }
  }

  const now = new Date().toISOString();
  for (const personId of affectedPersonIds) {
    const remaining = await db
      .select({ id: FaceTable.id, embedding: FaceTable.embedding })
      .from(FaceTable)
      .where(eq(FaceTable.personId, personId));

    if (remaining.length === 0) {
      await db.delete(PersonTable).where(eq(PersonTable.id, personId));
      continue;
    }

    // Recompute the centroid from the surviving faces so the removed faces no
    // longer pollute the running mean used for clustering.
    let dim = 0;
    for (const r of remaining) {
      const emb = parseEmbedding(r.embedding);
      if (emb && emb.length > dim) dim = emb.length;
    }
    let centroidJson: string | undefined;
    if (dim > 0) {
      const sums = new Array<number>(dim).fill(0);
      let counted = 0;
      for (const r of remaining) {
        const emb = parseEmbedding(r.embedding);
        if (!emb) continue;
        for (let i = 0; i < dim; i++) sums[i]! += emb[i] ?? 0;
        counted++;
      }
      if (counted > 0) centroidJson = JSON.stringify(sums.map((s) => s / counted));
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
        ...(centroidJson ? { centroid: centroidJson } : {}),
        ...(coverStillValid ? {} : { coverFaceId: remaining[0]!.id }),
        updatedAt: now,
      })
      .where(eq(PersonTable.id, personId));
  }
}

export async function deleteFilesWithCascade(fileIds: string[]) {
  if (!fileIds.length) return [];

  const idsToDelete = Array.from(new Set([...fileIds]));

  const variantRows = await db
    .select({ fileId: FileVariantTable.fileId })
    .from(FileVariantTable)
    .where(inArray(FileVariantTable.originalFileId, fileIds));

  const variantFileIds = variantRows.map((r) => r.fileId);
  idsToDelete.push(...variantFileIds);

  // Unlink the generated variant files from disk before dropping their rows,
  // otherwise the AVIF/MP4 outputs orphan on disk forever (D3).
  await deleteVariantFilesFromDisk(idsToDelete);

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

  // Remove detected faces and repair/clean up their person clusters.
  await removeFacesForFiles(idsToDelete);

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
