// Embedding helpers. Faces store an L2-normalized Float32 embedding as raw
// little-endian bytes in face.vec; rows from before that column hold a JSON
// number[] in face.embedding instead. Everything here works on unit vectors,
// so cosine similarity is a plain dot product.

export const EMBED_DIM = 512;

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n);
  if (n === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
  return v;
}

export function vecToBuffer(v: Float32Array): Buffer {
  const out = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) out.writeFloatLE(v[i]!, i * 4);
  return out;
}

export function bufferToVec(buf: Buffer | Uint8Array): Float32Array {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const v = new Float32Array(b.length / 4);
  for (let i = 0; i < v.length; i++) v[i] = b.readFloatLE(i * 4);
  return v;
}

export function base64ToVec(b64: string): Float32Array {
  return normalize(bufferToVec(Buffer.from(b64, "base64")));
}

// Read a face row's embedding from whichever column holds it, unit length.
export function faceVec(row: {
  vec?: Buffer | Uint8Array | null;
  embedding?: string | null;
}): Float32Array | null {
  if (row.vec && row.vec.length > 0) return bufferToVec(row.vec);
  if (!row.embedding) return null;
  try {
    const arr = JSON.parse(row.embedding);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return normalize(Float32Array.from(arr as number[]));
  } catch {
    return null;
  }
}

export function dot(a: Float32Array, b: Float32Array, bOffset = 0): number {
  let s = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) s += a[i]! * b[bOffset + i]!;
  return s;
}

// Mean of unit vectors, renormalized. Null when there are none.
export function meanVec(vs: Float32Array[]): Float32Array | null {
  if (vs.length === 0) return null;
  const m = new Float32Array(vs[0]!.length);
  for (const v of vs) for (let i = 0; i < m.length; i++) m[i] = m[i]! + v[i]!;
  return normalize(m);
}

export type Box = { x: number; y: number; width: number; height: number };

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
