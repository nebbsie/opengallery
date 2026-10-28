import { base64ToVec } from "../faces/vector.js";

const ML_SERVICE_URL = process.env["FACE_SERVICE_URL"] ?? "http://127.0.0.1:3220";

// Recent query embeddings: typing, paging and the suggestion box repeat them.
const cache = new Map<string, { model: string; vec: Float32Array }>();
const CACHE_MAX = 200;

// Embed a search text with the sidecar's image-text model. Null when the
// sidecar is down or has no model, so search falls back to plain text matching.
export async function embedText(text: string): Promise<{ model: string; vec: Float32Array } | null> {
  const key = text.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(`${ML_SERVICE_URL}/clip/text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: key }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { model: string; embedding: string };
    const out = { model: body.model, vec: base64ToVec(body.embedding) };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, out);
    return out;
  } catch {
    return null;
  }
}
