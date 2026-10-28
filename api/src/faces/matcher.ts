import type { LibraryFaceIndex } from "./face-index.js";
import {
  LOW_QUALITY,
  LOW_QUALITY_EXTRA,
  STRONG_EXTRA,
  VOTE_DOMINANCE,
  VOTE_K,
} from "./tuning.js";

export type MatchResult = { personId: string; score: number; best: number };

// Live matcher: k-nearest-neighbour vote over the faces that already belong to
// a person. Matching against real faces, not one mean per person, keeps a
// person whose look changes over the years (a child growing up, a beard, side
// views) together, where a single centroid drifts and splits them.
//
// A vote counts only from neighbours at least `threshold` similar. The winner
// must hold most of the vote weight and have one strong match, else the face
// stays unclustered and the next regroup decides.
export function matchFace(opts: {
  index: LibraryFaceIndex;
  vec: Float32Array;
  quality: number;
  threshold: number;
  // Faces in this photo: never a neighbour (one person appears once per photo).
  fileId: string;
  // People already used by another face in this photo, and people the user
  // said this face is not.
  blocked: Set<string>;
}): MatchResult | null {
  const { index, vec, quality, threshold, fileId, blocked } = opts;
  if (index.size === 0) return null;
  const sims = index.scan(vec);

  // Top VOTE_K assigned neighbours above the threshold (small k: insertion sort).
  const top: { sim: number; row: number }[] = [];
  for (let r = 0; r < sims.length; r++) {
    const s = sims[r]!;
    if (s < threshold) continue;
    if (!index.personIds[r] || index.fileIds[r] === fileId) continue;
    if (top.length === VOTE_K && s <= top[top.length - 1]!.sim) continue;
    if (top.length === VOTE_K) top.pop();
    let i = top.length;
    while (i > 0 && top[i - 1]!.sim < s) i--;
    top.splice(i, 0, { sim: s, row: r });
  }
  if (top.length === 0) return null;

  const weight = new Map<string, number>();
  const best = new Map<string, number>();
  let total = 0;
  for (const { sim, row } of top) {
    const p = index.personIds[row]!;
    // Low-quality neighbours count for less.
    const w = sim * (0.5 + 0.5 * Math.min(1, index.quality[row] ?? 1));
    weight.set(p, (weight.get(p) ?? 0) + w);
    best.set(p, Math.max(best.get(p) ?? -1, sim));
    total += w;
  }

  const strong = threshold + STRONG_EXTRA + (quality < LOW_QUALITY ? LOW_QUALITY_EXTRA : 0);
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]);
  for (const [personId, w] of ranked) {
    if (blocked.has(personId)) continue;
    if (w / total < VOTE_DOMINANCE) return null;
    const b = best.get(personId)!;
    if (b < strong) return null;
    return { personId, score: w / total, best: b };
  }
  return null;
}
