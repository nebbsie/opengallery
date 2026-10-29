import { and, eq, inArray, sql } from "drizzle-orm";
import { clearScopeCache } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { FileTable, FileTaskTable, FileVariantTable } from "../db/schema.js";
import { removeFacesForFiles } from "./file-operations.js";

// Turn photos by a quarter or a half (edit.rotateFiles). The original on disk
// is not touched: file.rotation is applied on top of the EXIF orientation by
// the worker. The variants stay in place (so the photo never leaves the grid)
// and are marked stale by their own rotation (file_variant.rotation), so the
// worker encodes them again and the asset route stops caching them meanwhile.
// Faces and the search embedding are made again from the turned pixels.
export async function rotateFiles(fileIds: string[], degrees: 90 | -90 | 180) {
  const rows = fileIds.length
    ? await db
        .select({ id: FileTable.id, name: FileTable.name, type: FileTable.type })
        .from(FileTable)
        .where(inArray(FileTable.id, fileIds))
    : [];
  const photos = rows.filter((r) => r.type === "image").map((r) => r.id);
  const failed = rows
    .filter((r) => r.type !== "image")
    .map((r) => ({ id: r.id, name: r.name, reason: "Videos cannot be rotated" }));
  if (photos.length === 0) return { rotated: 0, failed, files: [] as { id: string; rotation: number }[] };

  const now = new Date().toISOString();
  for (let i = 0; i < photos.length; i += 500) {
    const chunk = photos.slice(i, i + 500);
    db.transaction((tx) => {
      tx.update(FileTable)
        .set({
          rotation: sql`(((${FileTable.rotation} + ${degrees}) % 360) + 360) % 360`,
          updatedAt: now,
        })
        .where(inArray(FileTable.id, chunk))
        .run();
      // Encode again; face detection waits for the new optimised variant.
      tx.update(FileTaskTable)
        .set({
          status: "pending",
          attempts: 0,
          startedAt: null,
          finishedAt: null,
          lastError: null,
          progress: 0,
          updatedAt: now,
        })
        .where(
          and(
            inArray(FileTaskTable.fileId, chunk),
            inArray(FileTaskTable.type, ["encode_thumbnail", "encode_optimised", "detect_faces", "embed_clip"]),
          ),
        )
        .run();
    });
    // The face boxes were found on the old pixels.
    await removeFacesForFiles(chunk);
  }
  clearScopeCache();
  // The new turn of each photo, so the web can show the old variant turned
  // by CSS until the new one is encoded.
  const files: { id: string; rotation: number }[] = [];
  for (let i = 0; i < photos.length; i += 500) {
    files.push(
      ...(await db
        .select({ id: FileTable.id, rotation: FileTable.rotation })
        .from(FileTable)
        .where(inArray(FileTable.id, photos.slice(i, i + 500)))),
    );
  }
  return { rotated: photos.length, failed, files };
}

// Of fileIds, the photos whose thumbnail or optimised variant was made with
// another rotation than the photo has now (still being encoded again).
export async function rotationPending(fileIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < fileIds.length; i += 500) {
    const rows = await db
      .selectDistinct({ id: FileVariantTable.originalFileId })
      .from(FileVariantTable)
      .innerJoin(FileTable, eq(FileTable.id, FileVariantTable.originalFileId))
      .where(
        and(
          inArray(FileVariantTable.originalFileId, fileIds.slice(i, i + 500)),
          inArray(FileVariantTable.type, ["thumbnail", "optimised"]),
          sql`${FileVariantTable.rotation} <> ${FileTable.rotation}`,
        ),
      );
    out.push(...rows.map((r) => r.id));
  }
  return out;
}
