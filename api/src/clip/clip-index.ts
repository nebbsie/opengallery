import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { FileEmbeddingTable } from "../db/schema.js";
import { base64ToVec, bufferToVec } from "../faces/vector.js";

// In-memory matrix of every photo's image-text embedding (one model), for
// brute-force ranking: 20k photos x 768 floats is about 60 MB and a full scan
// takes a few milliseconds.
class ClipIndex {
  readonly ids: string[] = [];
  private rowOf = new Map<string, number>();
  private data = new Float32Array(0);
  constructor(
    readonly model: string,
    readonly dim: number,
  ) {}

  get size(): number {
    return this.ids.length;
  }

  upsert(fileId: string, vec: Float32Array): void {
    if (vec.length !== this.dim) return;
    let row = this.rowOf.get(fileId);
    if (row === undefined) {
      row = this.ids.length;
      this.ids.push(fileId);
      this.rowOf.set(fileId, row);
      if (this.data.length < this.ids.length * this.dim) {
        const next = new Float32Array(Math.max(this.ids.length * 2, 1024) * this.dim);
        next.set(this.data);
        this.data = next;
      }
    }
    this.data.set(vec, row * this.dim);
  }

  remove(fileId: string): void {
    const row = this.rowOf.get(fileId);
    if (row === undefined) return;
    // Zero vector: never ranks; the slot stays (rare, files are seldom deleted).
    this.rowOf.delete(fileId);
    this.ids[row] = "";
    this.data.fill(0, row * this.dim, (row + 1) * this.dim);
  }

  // Cosine score of q for each file in `only` (or every file), best first.
  rank(q: Float32Array, only: Set<string> | null): { fileId: string; score: number }[] {
    const out: { fileId: string; score: number }[] = [];
    const d = this.data;
    const dim = this.dim;
    for (let r = 0; r < this.ids.length; r++) {
      const id = this.ids[r]!;
      if (!id || (only && !only.has(id))) continue;
      let s = 0;
      const o = r * dim;
      for (let i = 0; i < dim; i++) s += q[i]! * d[o + i]!;
      out.push({ fileId: id, score: s });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}

let index: ClipIndex | null = null;
let loading: Promise<ClipIndex | null> | null = null;

// The index for the newest model in the table (null while nothing is embedded).
export async function getClipIndex(): Promise<ClipIndex | null> {
  if (index) return index;
  if (loading) return loading;
  loading = (async () => {
    const [latest] = await db
      .select({ model: FileEmbeddingTable.model })
      .from(FileEmbeddingTable)
      .orderBy(sql`${FileEmbeddingTable.updatedAt} DESC`)
      .limit(1);
    if (!latest) return null;
    const rows = await db
      .select({ fileId: FileEmbeddingTable.fileId, vec: FileEmbeddingTable.vec })
      .from(FileEmbeddingTable)
      .where(eq(FileEmbeddingTable.model, latest.model));
    const first = rows[0];
    if (!first) return null;
    const idx = new ClipIndex(latest.model, first.vec.length / 4);
    for (const r of rows) idx.upsert(r.fileId, bufferToVec(r.vec));
    index = idx;
    return idx;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export function addToClipIndex(fileId: string, model: string, b64: string): void {
  const vec = base64ToVec(b64);
  // A new model starts a fresh index (rebuilt from the table on next use).
  if (index && (index.model !== model || index.dim !== vec.length)) index = null;
  index?.upsert(fileId, vec);
}

export function removeFromClipIndex(fileIds: string[]): void {
  for (const id of fileIds) index?.remove(id);
}
