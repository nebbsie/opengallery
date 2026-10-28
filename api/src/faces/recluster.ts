import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { clearScopeCache } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import {
  FaceTable,
  FileTaskTable,
  LibraryFileTable,
  PersonTable,
  SystemSettingsTable,
} from "../db/schema.js";
import { logger } from "../logger.js";
import { pinViewerHiddenFaces } from "../utils/file-operations.js";
import {
  getCachedSystemSettings,
  invalidateSystemSettings,
} from "../utils/settings-cache.js";
import { invalidateFaceIndex, resolveCurrentModel, withFaceLock } from "./face-index.js";
import { getVoteThreshold } from "./ingest.js";
import { anchoredPeople, refreshPeople, rejectedPeopleFor } from "./people.js";
import {
  AUTO_RECLUSTER_AFTER,
  GRAPH_EDGE_EXTRA,
  GRAPH_K,
  GRAPH_ROUNDS,
  LOW_QUALITY,
  LOW_QUALITY_EXTRA,
  MIN_GROUP_SIZE,
} from "./tuning.js";
import { EMBED_DIM, faceVec } from "./vector.js";

const FACE_SERVICE_URL = process.env["FACE_SERVICE_URL"] ?? "http://127.0.0.1:3220";

// Ask the sidecar (numpy) for each face's nearest neighbours. Faces in the same
// photo are never neighbours.
async function knnGraph(
  matrix: Float32Array,
  groups: Int32Array,
  n: number,
  k: number,
): Promise<{ idx: Int32Array; sim: Float32Array; k: number }> {
  const body = Buffer.concat([
    Buffer.from(matrix.buffer, matrix.byteOffset, n * EMBED_DIM * 4),
    Buffer.from(groups.buffer, groups.byteOffset, n * 4),
  ]);
  const res = await fetch(`${FACE_SERVICE_URL}/knn?n=${n}&d=${EMBED_DIM}&k=${k}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body,
  });
  if (!res.ok) throw new Error(`face-service knn ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const kk = buf.length / (n * 8);
  // Copy into aligned typed arrays (the Buffer may not be 4-byte aligned).
  const idx = new Int32Array(n * kk);
  const sim = new Float32Array(n * kk);
  for (let i = 0; i < n * kk; i++) {
    idx[i] = buf.readInt32LE(i * 4);
    sim[i] = buf.readFloatLE(n * kk * 4 + i * 4);
  }
  return { idx, sim, k: kk };
}

// Deterministic shuffle so a regroup of the same data gives the same groups.
function shuffled(n: number, seed: number): Uint32Array {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  let s = seed >>> 0 || 1;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

export type ReclusterResult = {
  libraries: number;
  faces: number;
  groups: number;
  unclustered: number;
  changed: number;
  ms: number;
};

let running = false;
export function isReclusterRunning(): boolean {
  return running;
}

// Regroup every face of the current model, library by library.
//
// 1. kNN graph over all faces (sidecar, numpy). Edges below the threshold drop.
// 2. Label propagation (Chinese Whispers): each face takes the label with the
//    most edge weight among its neighbours. Faces the user confirmed, and faces
//    of people the user curated (named, merged), are fixed anchors whose labels
//    spread but never change. A face never takes a person it was rejected from.
// 3. One person per photo: if two faces in one photo end with the same label,
//    the better supported keeps it.
// 4. Labels become people. Anchors keep their person. A new group reuses the
//    existing unnamed person it overlaps most (stable ids, covers, viewer
//    rules), else a new person. A group smaller than MIN_GROUP_SIZE stays
//    unclustered instead of becoming a one-photo "person".
export async function reclusterAll(): Promise<ReclusterResult> {
  if (running) throw new Error("A regroup is already running");
  running = true;
  const t0 = Date.now();
  try {
    return await withFaceLock(async () => {
      const model = await resolveCurrentModel();
      const threshold = await getVoteThreshold();
      const libs = await db
        .selectDistinct({ libraryId: LibraryFileTable.libraryId })
        .from(FaceTable)
        .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FaceTable.fileId))
        .where(isNull(LibraryFileTable.deletedAt));
      const total: ReclusterResult = { libraries: 0, faces: 0, groups: 0, unclustered: 0, changed: 0, ms: 0 };
      for (const { libraryId } of libs) {
        const r = await reclusterLibrary(libraryId, model, threshold);
        total.libraries++;
        total.faces += r.faces;
        total.groups += r.groups;
        total.unclustered += r.unclustered;
        total.changed += r.changed;
      }
      await db
        .update(SystemSettingsTable)
        .set({ faceLastReclusterAt: new Date().toISOString() });
      invalidateSystemSettings();
      invalidateFaceIndex();
      clearScopeCache();
      total.ms = Date.now() - t0;
      logger.info(`[faces] regroup done: ${JSON.stringify(total)}`);
      return total;
    });
  } finally {
    running = false;
  }
}

async function reclusterLibrary(libraryId: string, model: string, threshold: number) {
  const rows = await db
    .select({
      id: FaceTable.id,
      fileId: FaceTable.fileId,
      personId: FaceTable.personId,
      confirmed: FaceTable.confirmed,
      quality: FaceTable.quality,
      vec: FaceTable.vec,
      embedding: FaceTable.embedding,
      model: FaceTable.model,
    })
    .from(FaceTable)
    .innerJoin(
      LibraryFileTable,
      and(eq(LibraryFileTable.fileId, FaceTable.fileId), isNull(LibraryFileTable.deletedAt)),
    )
    .where(and(eq(LibraryFileTable.libraryId, libraryId), eq(FaceTable.manual, false)));
  const faces = rows.filter((r) => (r.model ?? "buffalo_l") === model);
  const n = faces.length;
  if (n < 2) return { faces: n, groups: 0, unclustered: 0, changed: 0 };

  const people = await db
    .select({ id: PersonTable.id })
    .from(PersonTable)
    .where(eq(PersonTable.libraryId, libraryId));
  const pinned = await anchoredPeople(people.map((p) => p.id));
  const rejected = await rejectedPeopleFor(faces.map((f) => f.id));

  const matrix = new Float32Array(n * EMBED_DIM);
  const groups = new Int32Array(n);
  const fileNum = new Map<string, number>();
  const quality = new Float32Array(n);
  faces.forEach((f, i) => {
    const v = faceVec(f);
    if (v && v.length === EMBED_DIM) matrix.set(v, i * EMBED_DIM);
    let g = fileNum.get(f.fileId);
    if (g === undefined) fileNum.set(f.fileId, (g = fileNum.size));
    groups[i] = g;
    quality[i] = f.quality ?? 1;
  });
  const { idx, sim, k } = await knnGraph(matrix, groups, n, GRAPH_K);
  const edge = threshold + GRAPH_EDGE_EXTRA;

  // Labels: 0..P-1 = existing people (anchors), P+i = face i on its own.
  const personLabel = new Map<string, number>();
  const labelPerson: string[] = [];
  const labelOf = (personId: string) => {
    let l = personLabel.get(personId);
    if (l === undefined) {
      l = labelPerson.length;
      personLabel.set(personId, l);
      labelPerson.push(personId);
    }
    return l;
  };
  const anchor = new Uint8Array(n);
  const label = new Int32Array(n);
  faces.forEach((f, i) => {
    if (f.personId && (f.confirmed || pinned.has(f.personId))) {
      anchor[i] = 1;
      label[i] = labelOf(f.personId);
    }
  });
  const P = labelPerson.length;
  for (let i = 0; i < n; i++) if (!anchor[i]) label[i] = P + i;
  const rejectedLabels: (Set<number> | undefined)[] = faces.map((f) => {
    const r = rejected.get(f.id);
    if (!r) return undefined;
    return new Set([...r].map((p) => personLabel.get(p)).filter((l): l is number => l !== undefined));
  });

  const score = new Map<number, number>();
  const bestSim = new Map<number, number>();
  const support = new Float32Array(n);
  for (let round = 0; round < GRAPH_ROUNDS; round++) {
    let changes = 0;
    for (const i of shuffled(n, 7 + round)) {
      if (anchor[i]) continue;
      score.clear();
      bestSim.clear();
      for (let j = 0; j < k; j++) {
        const s = sim[i * k + j]!;
        if (s < edge) break;
        const nb = idx[i * k + j]!;
        const l = label[nb]!;
        if (rejectedLabels[i]?.has(l)) continue;
        score.set(l, (score.get(l) ?? 0) + s * (0.5 + 0.5 * Math.min(1, quality[nb]!)));
        bestSim.set(l, Math.max(bestSim.get(l) ?? -1, s));
      }
      let bestL = P + i;
      let bestW = 0;
      for (const [l, w] of score) {
        // A low-quality face joins only on a clearly strong link.
        if (quality[i]! < LOW_QUALITY && bestSim.get(l)! < edge + LOW_QUALITY_EXTRA) continue;
        if (w > bestW) {
          bestW = w;
          bestL = l;
        }
      }
      support[i] = bestW;
      if (label[i] !== bestL) {
        label[i] = bestL;
        changes++;
      }
    }
    if (changes === 0) break;
  }

  // One person per photo.
  const byFile = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const list = byFile.get(groups[i]!) ?? [];
    list.push(i);
    byFile.set(groups[i]!, list);
  }
  for (const list of byFile.values()) {
    if (list.length < 2) continue;
    const seen = new Map<number, number>();
    const rank = (i: number) =>
      (faces[i]!.confirmed ? 4 : 0) + (anchor[i] ? 2 : 0) + support[i]! / 100 + quality[i]! / 1000;
    for (const i of [...list].sort((a, b) => rank(b) - rank(a))) {
      if (seen.has(label[i]!)) label[i] = P + i;
      else seen.set(label[i]!, i);
    }
  }

  // Labels -> people.
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const list = members.get(label[i]!) ?? [];
    list.push(i);
    members.set(label[i]!, list);
  }
  const target = new Array<string | null>(n).fill(null);
  type Fresh = { faces: number[]; overlap: Map<string, number> };
  const fresh: Fresh[] = [];
  for (const [l, list] of members) {
    if (l < P) {
      for (const i of list) target[i] = labelPerson[l]!;
      continue;
    }
    const good = list.filter((i) => quality[i]! >= LOW_QUALITY).length;
    if (list.length < MIN_GROUP_SIZE || good < MIN_GROUP_SIZE) continue;
    const overlap = new Map<string, number>();
    for (const i of list) {
      const p = faces[i]!.personId;
      // A person that holds anchors keeps its own label; never reuse it.
      if (p && !pinned.has(p) && !personLabel.has(p)) overlap.set(p, (overlap.get(p) ?? 0) + 1);
    }
    fresh.push({ faces: list, overlap });
  }
  // Reuse existing unnamed people, biggest overlaps first, each once.
  const claims = fresh
    .flatMap((g, gi) => [...g.overlap].map(([p, c]) => ({ gi, p, c })))
    .sort((a, b) => b.c - a.c);
  const groupPerson = new Map<number, string>();
  const takenPeople = new Set<string>();
  for (const c of claims) {
    if (groupPerson.has(c.gi) || takenPeople.has(c.p)) continue;
    groupPerson.set(c.gi, c.p);
    takenPeople.add(c.p);
  }
  for (let gi = 0; gi < fresh.length; gi++) {
    let personId = groupPerson.get(gi);
    if (!personId) {
      const [row] = await db
        .insert(PersonTable)
        .values({ libraryId, faceCount: fresh[gi]!.faces.length })
        .returning({ id: PersonTable.id });
      personId = row!.id;
    }
    for (const i of fresh[gi]!.faces) target[i] = personId;
  }

  // A face never lands on a person the user said it is not (a reused person
  // id can bring one back even though its label was free).
  faces.forEach((f, i) => {
    if (target[i] && rejected.get(f.id)?.has(target[i]!)) target[i] = null;
  });

  // Apply.
  const changed: number[] = [];
  for (let i = 0; i < n; i++) if ((faces[i]!.personId ?? null) !== target[i]) changed.push(i);
  if (changed.length > 0) {
    const files = [...new Set(changed.filter((i) => faces[i]!.personId).map((i) => faces[i]!.fileId))];
    for (let c = 0; c < files.length; c += 400) await pinViewerHiddenFaces(files.slice(c, c + 400));
    const now = new Date().toISOString();
    db.transaction((tx) => {
      for (const i of changed) {
        tx.update(FaceTable)
          .set({ personId: target[i], updatedAt: now })
          .where(eq(FaceTable.id, faces[i]!.id))
          .run();
      }
    });
  }
  const affected = new Set<string>(people.map((p) => p.id));
  for (const t of target) if (t) affected.add(t);
  await refreshPeople(affected);

  return {
    faces: n,
    groups: fresh.length,
    unclustered: target.filter((t) => t === null).length,
    changed: changed.length,
  };
}

// --- automatic regroup -------------------------------------------------------

let pending = 0;
// Called by ingest with the number of good faces that stayed unclustered.
export function noteNewFaces(count: number): void {
  pending += count;
}

async function detectionIdle(): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(FileTaskTable)
    .where(
      and(
        eq(FileTaskTable.type, "detect_faces"),
        inArray(FileTaskTable.status, ["pending", "in_progress"]),
      ),
    );
  return (row?.n ?? 0) === 0;
}

// Good unclustered faces that arrived since the last regroup (survives restarts).
async function unclusteredSinceLastRegroup(): Promise<number> {
  const s = await getCachedSystemSettings();
  const since = s?.faceLastReclusterAt ?? "";
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(FaceTable)
    .where(
      and(
        isNull(FaceTable.personId),
        eq(FaceTable.manual, false),
        isNotNull(FaceTable.vec),
        gt(FaceTable.updatedAt, since),
      ),
    );
  return row?.n ?? 0;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startAutoRecluster(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    try {
      const fresh = pending >= AUTO_RECLUSTER_AFTER ? pending : await unclusteredSinceLastRegroup();
      if (fresh === 0) return;
      if (fresh >= AUTO_RECLUSTER_AFTER || (await detectionIdle())) {
        pending = 0;
        await reclusterAll();
      }
    } catch (e) {
      logger.warn("[faces] automatic regroup failed", e as Error);
    }
  }, 60_000);
  timer.unref?.();
}
