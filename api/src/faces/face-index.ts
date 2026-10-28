import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { FaceTable, LibraryFileTable } from "../db/schema.js";
import { EMBED_DIM, faceVec } from "./vector.js";

// Serializes every write that changes which person a face belongs to (live
// matching, regroup, merges, user answers). better-sqlite3 is synchronous, but
// the tRPC handlers await between their reads and writes, so without this two
// requests can read the same state and the second write loses the first.
let chain: Promise<unknown> = Promise.resolve();
export function withFaceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

// In-memory embedding matrix for one library and one model, for brute-force
// nearest-neighbour search. 20k faces x 512 floats is about 40 MB and a full
// scan takes a few milliseconds, which beats any ANN index at this size.
export class LibraryFaceIndex {
  ids: string[] = [];
  personIds: (string | null)[] = [];
  fileIds: string[] = [];
  quality: number[] = [];
  private rowOf = new Map<string, number>();
  private data = new Float32Array(0);
  private free: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  rowFor(faceId: string): number | undefined {
    return this.rowOf.get(faceId);
  }

  vectorAt(row: number): Float32Array {
    return this.data.subarray(row * EMBED_DIM, (row + 1) * EMBED_DIM);
  }

  matrix(): Float32Array {
    return this.data.subarray(0, this.ids.length * EMBED_DIM);
  }

  upsert(f: {
    id: string;
    personId: string | null;
    fileId: string;
    quality: number;
    vec: Float32Array;
  }): void {
    let row = this.rowOf.get(f.id);
    if (row === undefined) {
      row = this.free.pop() ?? this.ids.length;
      if (row === this.ids.length) {
        this.ids.push(f.id);
        this.personIds.push(null);
        this.fileIds.push("");
        this.quality.push(0);
      }
      this.ensureCapacity(this.ids.length);
      this.rowOf.set(f.id, row);
    }
    this.ids[row] = f.id;
    this.personIds[row] = f.personId;
    this.fileIds[row] = f.fileId;
    this.quality[row] = f.quality;
    this.data.set(f.vec.subarray(0, EMBED_DIM), row * EMBED_DIM);
  }

  remove(faceId: string): void {
    const row = this.rowOf.get(faceId);
    if (row === undefined) return;
    this.rowOf.delete(faceId);
    // Tombstone: an empty id and a zero vector never match anything.
    this.ids[row] = "";
    this.personIds[row] = null;
    this.fileIds[row] = "";
    this.data.fill(0, row * EMBED_DIM, (row + 1) * EMBED_DIM);
    this.free.push(row);
  }

  setPerson(faceId: string, personId: string | null): void {
    const row = this.rowOf.get(faceId);
    if (row !== undefined) this.personIds[row] = personId;
  }

  // Cosine similarity of q against every live row.
  scan(q: Float32Array): Float32Array {
    const n = this.ids.length;
    const out = new Float32Array(n);
    const d = this.data;
    for (let r = 0; r < n; r++) {
      let s = 0;
      const o = r * EMBED_DIM;
      for (let i = 0; i < EMBED_DIM; i++) s += q[i]! * d[o + i]!;
      out[r] = this.ids[r] ? s : -2;
    }
    return out;
  }

  private ensureCapacity(rows: number): void {
    if (this.data.length >= rows * EMBED_DIM) return;
    const next = new Float32Array(Math.max(rows, Math.ceil(this.data.length / EMBED_DIM) * 2, 1024) * EMBED_DIM);
    next.set(this.data);
    this.data = next;
  }
}

// Faces made before face.model existed are from buffalo_l.
const LEGACY_MODEL = "buffalo_l";

const cache = new Map<string, LibraryFaceIndex>();
const key = (libraryId: string, model: string) => `${libraryId}|${model}`;

export async function getLibraryIndex(
  libraryId: string,
  model: string,
): Promise<LibraryFaceIndex> {
  const k = key(libraryId, model);
  const hit = cache.get(k);
  if (hit) return hit;

  const modelCond =
    model === LEGACY_MODEL
      ? or(eq(FaceTable.model, model), isNull(FaceTable.model))
      : eq(FaceTable.model, model);
  const rows = await db
    .select({
      id: FaceTable.id,
      personId: FaceTable.personId,
      fileId: FaceTable.fileId,
      quality: FaceTable.quality,
      vec: FaceTable.vec,
      embedding: FaceTable.embedding,
    })
    .from(FaceTable)
    .innerJoin(
      LibraryFileTable,
      and(
        eq(LibraryFileTable.fileId, FaceTable.fileId),
        isNull(LibraryFileTable.deletedAt),
      ),
    )
    .where(
      and(
        eq(LibraryFileTable.libraryId, libraryId),
        modelCond,
        or(isNotNull(FaceTable.vec), isNotNull(FaceTable.embedding)),
      ),
    );

  const index = new LibraryFaceIndex();
  for (const r of rows) {
    const v = faceVec(r);
    if (!v || v.length !== EMBED_DIM) continue;
    index.upsert({
      id: r.id,
      personId: r.personId,
      fileId: r.fileId,
      quality: r.quality ?? 1,
      vec: v,
    });
  }
  cache.set(k, index);
  return index;
}

// Drop cached indexes after bulk changes (merge, regroup, deletes); the next
// match rebuilds from the database.
export function invalidateFaceIndex(): void {
  cache.clear();
}

// Keep cached indexes in step with a person change for some faces.
export function setPersonInIndexes(faceIds: string[], personId: string | null): void {
  for (const idx of cache.values()) for (const id of faceIds) idx.setPerson(id, personId);
}

export function removeFromIndexes(faceIds: string[]): void {
  for (const idx of cache.values()) for (const id of faceIds) idx.remove(id);
}

// Which model the live index uses for a library: the newest model seen.
let currentModel: string | null = null;
export function noteModel(model: string): void {
  currentModel = model;
}
export async function resolveCurrentModel(): Promise<string> {
  if (currentModel) return currentModel;
  const [row] = await db
    .select({ model: FaceTable.model })
    .from(FaceTable)
    .where(isNotNull(FaceTable.vec))
    .orderBy(sql`${FaceTable.updatedAt} DESC`)
    .limit(1);
  return row?.model ?? LEGACY_MODEL;
}
