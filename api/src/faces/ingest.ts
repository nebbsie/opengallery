import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { clearScopeCache } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import {
  FaceRejectionTable,
  FaceTable,
  FileTable,
  LibraryFileTable,
} from "../db/schema.js";
import { getCachedSystemSettings } from "../utils/settings-cache.js";
import { pinViewerHiddenFaces } from "../utils/file-operations.js";
import { resolveAssetPath } from "../utils/media-path.js";
import {
  getLibraryIndex,
  noteModel,
  removeFromIndexes,
  withFaceLock,
} from "./face-index.js";
import { matchFace } from "./matcher.js";
import { anchoredPeople, refreshPeople, rejectedPeopleFor } from "./people.js";
import { noteNewFaces } from "./recluster.js";
import { CARRY_IOU, DEFAULT_VOTE_SIM, LOW_QUALITY, faceQuality } from "./tuning.js";
import { base64ToVec, bufferToVec, dot, iou, vecToBuffer, type Box } from "./vector.js";

// Video rescan: an old and a new face of one video are the same face when
// their embeddings (same model) are at least this similar.
const VIDEO_CARRY_SIM = 0.5;

export type IngestFace = {
  box: Box;
  // base64 little-endian float32[512]
  embedding: string;
  detScore: number;
  facePx: number;
  blur: number;
  yaw: number;
};

export async function resolveLibraryId(fileId: string): Promise<string | null> {
  const [row] = await db
    .select({ libraryId: LibraryFileTable.libraryId })
    .from(LibraryFileTable)
    .where(and(eq(LibraryFileTable.fileId, fileId), isNull(LibraryFileTable.deletedAt)))
    .limit(1);
  return row?.libraryId ?? null;
}

export async function getVoteThreshold(): Promise<number> {
  const row = await getCachedSystemSettings();
  return row?.faceMatchThreshold ?? DEFAULT_VOTE_SIM;
}

export async function unlinkCrop(cropDir: string | null, cropName: string | null) {
  if (!cropDir || !cropName) return;
  try {
    await fs.promises.unlink(await resolveAssetPath(path.resolve(path.join(cropDir, cropName))));
  } catch {
    // Best-effort: already gone.
  }
}

// Replace the detected faces of one file with a fresh detection, in one step.
//
// A new face that overlaps an old face (same photo, IoU >= CARRY_IOU) reuses
// the old row: its id, its user answers (confirmed, rejections) and, when the
// old person was confirmed or curated by a user, its person. So a rescan with a
// new model keeps names and answers. Faces drawn by a user are never touched.
// Everything else goes through the live matcher, and a face with no confident
// match stays unclustered until the next regroup.
export async function ingestFileFaces(input: {
  fileId: string;
  model: string;
  faces: IngestFace[];
}): Promise<{ faces: { faceId: string; personId: string | null }[] }> {
  return withFaceLock(async () => {
    noteModel(input.model);
    const libraryId = await resolveLibraryId(input.fileId);
    if (!libraryId) throw new Error(`No library for file ${input.fileId}`);
    const threshold = await getVoteThreshold();

    const old = await db
      .select({
        id: FaceTable.id,
        personId: FaceTable.personId,
        boxX: FaceTable.boxX,
        boxY: FaceTable.boxY,
        boxW: FaceTable.boxW,
        boxH: FaceTable.boxH,
        manual: FaceTable.manual,
        confirmed: FaceTable.confirmed,
        cropDir: FaceTable.cropDir,
        cropName: FaceTable.cropName,
        vec: FaceTable.vec,
        model: FaceTable.model,
      })
      .from(FaceTable)
      .where(eq(FaceTable.fileId, input.fileId));
    const [file] = await db
      .select({ type: FileTable.type })
      .from(FileTable)
      .where(eq(FileTable.id, input.fileId))
      .limit(1);
    const isVideo = file?.type === "video";
    const oldDetected = old.filter((o) => !o.manual);
    const oldPersonIds = [...new Set(old.map((o) => o.personId).filter((p): p is string => !!p))];
    const pinned = await anchoredPeople(oldPersonIds);
    const rejected = await rejectedPeopleFor(oldDetected.map((o) => o.id));

    const newVecs = input.faces.map((f) => base64ToVec(f.embedding));

    // Pair new faces with old ones, best pairs first. Photos: by box overlap.
    // Videos: each face comes from that person's best frame, so boxes of two
    // scans are from different frames; pair by embedding instead (same model
    // only; across models there is no safe pairing).
    const pairs: { n: number; o: number; v: number }[] = [];
    input.faces.forEach((f, n) =>
      oldDetected.forEach((o, oi) => {
        if (isVideo) {
          if (!o.vec || o.model !== input.model) return;
          const v = dot(newVecs[n]!, bufferToVec(o.vec));
          if (v >= VIDEO_CARRY_SIM) pairs.push({ n, o: oi, v });
          return;
        }
        const v = iou(f.box, { x: o.boxX, y: o.boxY, width: o.boxW, height: o.boxH });
        if (v >= CARRY_IOU) pairs.push({ n, o: oi, v });
      }),
    );
    pairs.sort((a, b) => b.v - a.v);
    const oldFor = new Map<number, (typeof oldDetected)[number]>();
    const usedOld = new Set<number>();
    for (const p of pairs) {
      if (oldFor.has(p.n) || usedOld.has(p.o)) continue;
      oldFor.set(p.n, oldDetected[p.o]!);
      usedOld.add(p.o);
    }

    const prepared = input.faces.map((f, n) => ({
      f,
      n,
      vec: newVecs[n]!,
      quality: faceQuality(f),
      prev: oldFor.get(n),
    }));

    // An old face the new scan did not find, but that carries a user answer
    // (confirmed, or on a curated/hidden person), is kept as a drawn face
    // rather than deleted, so a rescan never loses an answer.
    const pairedIds = new Set([...oldFor.values()].map((o) => o.id));
    const orphans = oldDetected.filter((o) => !pairedIds.has(o.id));
    const keepOrphans = orphans.filter(
      (o) => o.confirmed || (o.personId && pinned.has(o.personId)),
    );

    // One person appears at most once per photo, counting faces users drew.
    const used = new Set<string>(
      [...old.filter((o) => o.manual), ...keepOrphans]
        .map((o) => o.personId)
        .filter((p): p is string => !!p),
    );
    const decided = new Map<number, { personId: string | null; confirmed: boolean }>();

    // 1. Carry over answers and curated people.
    for (const p of prepared) {
      const prev = p.prev;
      if (!prev?.personId || used.has(prev.personId)) continue;
      if (prev.confirmed || pinned.has(prev.personId)) {
        decided.set(p.n, { personId: prev.personId, confirmed: prev.confirmed });
        used.add(prev.personId);
      }
    }

    // 2. Live match the rest, best quality first.
    const index = await getLibraryIndex(libraryId, input.model);
    const rest = prepared.filter((p) => !decided.has(p.n)).sort((a, b) => b.quality - a.quality);
    for (const p of rest) {
      const blocked = new Set(used);
      for (const r of rejected.get(p.prev?.id ?? "") ?? []) blocked.add(r);
      const m = matchFace({
        index,
        vec: p.vec,
        quality: p.quality,
        threshold,
        fileId: input.fileId,
        blocked,
      });
      if (m) used.add(m.personId);
      decided.set(p.n, { personId: m?.personId ?? null, confirmed: false });
    }

    // Removing or moving a face can un-hide this photo for a viewer the old
    // person was hidden from. Pin those rules to the file first.
    const keepIds = new Set(keepOrphans.map((o) => o.id));
    const removed = orphans.filter((o) => !keepIds.has(o.id));
    const moved = prepared.some(
      (p) => p.prev && p.prev.personId && decided.get(p.n)!.personId !== p.prev.personId,
    );
    if (removed.some((o) => o.personId) || moved) {
      if (await pinViewerHiddenFaces([input.fileId])) clearScopeCache();
    }

    const now = new Date().toISOString();
    const out: { faceId: string; personId: string | null }[] = [];
    const affected = new Set<string>(oldPersonIds);
    let unclustered = 0;

    if (keepOrphans.length > 0) {
      await db
        .update(FaceTable)
        .set({ manual: true, updatedAt: now })
        .where(inArray(FaceTable.id, keepOrphans.map((o) => o.id)));
      // Drawn faces never vote in matching.
      removeFromIndexes(keepOrphans.map((o) => o.id));
    }

    if (removed.length > 0) {
      const ids = removed.map((o) => o.id);
      await db.delete(FaceTable).where(inArray(FaceTable.id, ids));
      await db.delete(FaceRejectionTable).where(inArray(FaceRejectionTable.faceId, ids));
      removeFromIndexes(ids);
      for (const o of removed) await unlinkCrop(o.cropDir, o.cropName);
    }

    for (const p of prepared) {
      const d = decided.get(p.n)!;
      if (d.personId) affected.add(d.personId);
      else if (p.quality >= LOW_QUALITY) unclustered++;
      const values = {
        personId: d.personId,
        confirmed: d.confirmed,
        embedding: null,
        vec: vecToBuffer(p.vec),
        model: input.model,
        quality: p.quality,
        yaw: p.f.yaw,
        boxX: p.f.box.x,
        boxY: p.f.box.y,
        boxW: p.f.box.width,
        boxH: p.f.box.height,
        detScore: p.f.detScore,
        updatedAt: now,
      };
      let faceId: string;
      if (p.prev) {
        await db.update(FaceTable).set(values).where(eq(FaceTable.id, p.prev.id));
        faceId = p.prev.id;
        // The model may have changed: drop it from any older-model index.
        removeFromIndexes([faceId]);
      } else {
        const [row] = await db
          .insert(FaceTable)
          .values({ ...values, fileId: input.fileId })
          .returning({ id: FaceTable.id });
        faceId = row!.id;
      }
      index.upsert({
        id: faceId,
        personId: d.personId,
        fileId: input.fileId,
        quality: p.quality,
        vec: p.vec,
      });
      out.push({ faceId, personId: d.personId });
    }

    await refreshPeople(affected);
    noteNewFaces(unclustered);
    return { faces: out };
  });
}
