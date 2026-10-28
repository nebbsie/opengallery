import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  FaceRejectionTable,
  FaceTable,
  PersonMergeDismissedTable,
  PersonTable,
  ViewerHiddenPersonTable,
} from "../db/schema.js";
import { deleteViewerRulesForPeople } from "../utils/file-operations.js";
import { faceVec, meanVec } from "./vector.js";

const CHUNK = 400;

// Recompute face count, centroid and cover for the given people from their
// current faces. An unnamed person with no faces left is deleted (with its
// viewer rules and merge dismissals). A named person is kept even when empty,
// so the name stays available to put faces back on. Returns the deleted ids.
export async function refreshPeople(personIds: Iterable<string>): Promise<string[]> {
  const ids = [...new Set(personIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const now = new Date().toISOString();
  const deleted: string[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const people = await db
      .select({
        id: PersonTable.id,
        name: PersonTable.name,
        coverFaceId: PersonTable.coverFaceId,
      })
      .from(PersonTable)
      .where(inArray(PersonTable.id, chunk));
    const faces = await db
      .select({
        id: FaceTable.id,
        personId: FaceTable.personId,
        vec: FaceTable.vec,
        embedding: FaceTable.embedding,
        model: FaceTable.model,
        quality: FaceTable.quality,
        confirmed: FaceTable.confirmed,
        cropName: FaceTable.cropName,
      })
      .from(FaceTable)
      .where(inArray(FaceTable.personId, chunk));
    const byPerson = new Map<string, typeof faces>();
    for (const f of faces) {
      const list = byPerson.get(f.personId!) ?? [];
      list.push(f);
      byPerson.set(f.personId!, list);
    }

    for (const p of people) {
      const list = byPerson.get(p.id) ?? [];
      if (list.length === 0) {
        if (p.name) {
          await db
            .update(PersonTable)
            .set({ faceCount: 0, coverFaceId: null, updatedAt: now })
            .where(eq(PersonTable.id, p.id));
        } else {
          deleted.push(p.id);
        }
        continue;
      }
      // Mid-rescan a person holds faces from two models; the mean only makes
      // sense within one, so use the model most of its faces have.
      const models = new Map<string, number>();
      for (const f of list) if (f.vec || f.embedding) models.set(f.model ?? "", (models.get(f.model ?? "") ?? 0) + 1);
      const model = [...models].sort((a, b) => b[1] - a[1])[0]?.[0];
      const vecs = list
        .filter((f) => (f.model ?? "") === model)
        .map((f) => faceVec(f))
        .filter((v): v is Float32Array => !!v);
      const centroid = meanVec(vecs);
      const coverOk = !!p.coverFaceId && list.some((f) => f.id === p.coverFaceId);
      // Best avatar: a confirmed face first, then the highest quality, and
      // only faces that have a crop on disk.
      const best = [...list].sort(
        (a, b) =>
          Number(!!b.cropName) - Number(!!a.cropName) ||
          Number(b.confirmed) - Number(a.confirmed) ||
          (b.quality ?? 0.5) - (a.quality ?? 0.5),
      )[0]!;
      await db
        .update(PersonTable)
        .set({
          faceCount: list.length,
          centroid: centroid ? JSON.stringify(Array.from(centroid)) : null,
          ...(coverOk ? {} : { coverFaceId: best.id }),
          updatedAt: now,
        })
        .where(eq(PersonTable.id, p.id));
    }
  }

  if (deleted.length > 0) await deletePeopleRows(deleted);
  return deleted;
}

// Delete person rows and everything keyed on them. Faces must already be off
// these people.
export async function deletePeopleRows(personIds: string[]): Promise<void> {
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const chunk = personIds.slice(i, i + CHUNK);
    // The answers were about these people; with them gone the faces are free.
    await db
      .update(FaceTable)
      .set({ personId: null, confirmed: false })
      .where(inArray(FaceTable.personId, chunk));
    await db.delete(PersonTable).where(inArray(PersonTable.id, chunk));
    await db
      .delete(FaceRejectionTable)
      .where(inArray(FaceRejectionTable.personId, chunk));
    await db
      .delete(PersonMergeDismissedTable)
      .where(
        or(
          inArray(PersonMergeDismissedTable.personIdLow, chunk),
          inArray(PersonMergeDismissedTable.personIdHigh, chunk),
        ),
      );
  }
  await deleteViewerRulesForPeople(personIds);
}

// Person ids a face must never join (user said "not this person").
export async function rejectedPeopleFor(faceIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < faceIds.length; i += CHUNK) {
    const rows = await db
      .select({ faceId: FaceRejectionTable.faceId, personId: FaceRejectionTable.personId })
      .from(FaceRejectionTable)
      .where(inArray(FaceRejectionTable.faceId, faceIds.slice(i, i + CHUNK)));
    for (const r of rows) {
      const set = out.get(r.faceId) ?? new Set<string>();
      set.add(r.personId);
      out.set(r.faceId, set);
    }
  }
  return out;
}

// People whose faces a regroup or rescan must never move: curated by a user
// (pinned), hidden from everyone, or hidden from some viewer. Moving their
// faces would delete the person and with it the hide rule.
export async function anchoredPeople(personIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const chunk = personIds.slice(i, i + CHUNK);
    const rows = await db
      .select({ id: PersonTable.id })
      .from(PersonTable)
      .where(
        and(
          inArray(PersonTable.id, chunk),
          or(eq(PersonTable.pinned, true), eq(PersonTable.hidden, true)),
        ),
      );
    for (const r of rows) out.add(r.id);
    const rules = await db
      .selectDistinct({ id: ViewerHiddenPersonTable.personId })
      .from(ViewerHiddenPersonTable)
      .where(inArray(ViewerHiddenPersonTable.personId, chunk));
    for (const r of rules) out.add(r.id);
  }
  return out;
}

// Unclustered faces of a library, for status counts.
export function unclusteredWhere() {
  return and(isNull(FaceTable.personId), eq(FaceTable.manual, false));
}
