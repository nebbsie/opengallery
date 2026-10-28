// Face matching constants. Calibrated on a real library (about 22k faces, 50
// named people) with scripts/face-eval. buffalo_l, full-resolution alignment:
// pair similarity 0.31 = 1 false accept in 1,000 pairs, 0.39 = 1 in 10,000.
// The kNN vote at 0.36 got 99.9% of held-out named faces right with no wrong
// answers; a regroup at 0.42 + GRAPH_EDGE_EXTRA moved 4,558 faces onto named
// people and 99.7% of them agreed with a vote over the original named faces.
// Re-run that harness before you change any of these.

// A neighbour face votes for its person only when it is at least this similar.
// Overridden by SystemSettingsTable.faceMatchThreshold (Settings > Faces).
export const DEFAULT_VOTE_SIM = 0.4;

// How many nearest assigned faces vote in the live matcher.
export const VOTE_K = 20;

// The winning person must hold at least this share of the vote weight.
export const VOTE_DOMINANCE = 0.6;

// A face joins a person only if its single best match there is at least
// threshold + this. Stops a face that only weakly touches a group from joining.
export const STRONG_EXTRA = 0.05;

// Low-quality faces (tiny, blurred, profile) need this much more similarity,
// and never start a group on their own.
export const LOW_QUALITY = 0.35;
export const LOW_QUALITY_EXTRA = 0.08;

// Regroup (faces/recluster.ts): neighbours per face in the kNN graph, the edge
// threshold relative to the vote threshold, label-propagation rounds, and the
// smallest group that becomes a person.
export const GRAPH_K = 30;
export const GRAPH_EDGE_EXTRA = 0.02;
export const GRAPH_ROUNDS = 20;
export const MIN_GROUP_SIZE = 2;

// Regroup on its own after this many faces land unclustered since the last
// regroup, or when detection goes idle with any new faces.
export const AUTO_RECLUSTER_AFTER = 500;

// A rescanned face keeps the old face's row (id, person, answers) when their
// boxes overlap at least this much.
export const CARRY_IOU = 0.5;

// Face quality in 0..1 from the sidecar's raw signals. The smallest of the
// parts wins: one bad signal (a 20px face, a profile, motion blur) is enough to
// make an embedding unreliable.
export function faceQuality(f: {
  detScore: number;
  facePx: number;
  blur: number;
  yaw: number;
}): number {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const size = clamp((f.facePx - 24) / (96 - 24));
  const sharp = clamp((Math.log10(Math.max(f.blur, 1)) - 1.0) / (2.3 - 1.0));
  const pose = clamp(1 - (f.yaw - 0.25) / 0.45);
  const det = clamp((f.detScore - 0.5) / (0.8 - 0.5));
  return Math.min(size, sharp, pose, det);
}
