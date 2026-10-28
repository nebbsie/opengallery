"""
Score face embedding variants on a real library. Input: the JSON that
extract.py writes (per face: curated person name or null, quality signals, and
embeddings e1/e2/e3). Named people are the ground truth.

  e1 = buffalo_l ResNet50, aligned from a 1024px copy (the old pipeline)
  e2 = buffalo_l ResNet50, aligned from the full-resolution photo
  e3 = antelopev2 ResNet100 (Glint360K), aligned from the full-resolution photo

Reports, per variant:
  - verification: true-accept rate at a fixed false-accept rate over all
    named-face pairs, overall and for hard pairs (side faces, small faces)
  - leave-one-out kNN vote accuracy (the live matcher) at several thresholds
  - the similarity threshold at FAR 1e-3, to calibrate api/src/faces/tuning.ts

Usage: python3 evaluate.py emb.json
"""
import json
import sys

import numpy as np

rows = json.load(open(sys.argv[1]))
named = [r for r in rows if r["name"]]
names = sorted({r["name"] for r in named})
lab = np.array([names.index(r["name"]) for r in named])
yaw = np.array([r["yaw"] for r in named])
px = np.array([r["facepx"] for r in named])
fid = np.array([r["file"] for r in named])
print(f"faces={len(rows)} named={len(named)} people={len(names)}")

iu = np.triu_indices(len(named), 1)
same = (lab[:, None] == lab[None, :])[iu]
diffphoto = (fid[:, None] != fid[None, :])[iu]
hard_pose = (np.maximum(yaw[:, None], yaw[None, :]) > 0.35)[iu]
hard_size = (np.minimum(px[:, None], px[None, :]) < 60)[iu]


def tar_at(s, mask, far):
    neg = np.sort(s[(~same) & diffphoto & mask])[::-1]
    pos = s[same & diffphoto & mask]
    if len(neg) == 0 or len(pos) == 0:
        return float("nan"), float("nan")
    t = neg[min(len(neg) - 1, int(far * len(neg)))]
    return float((pos > t).mean()), float(t)


def loo(E, th, k=20, dom=0.6, strong=0.05):
    S = E @ E.T
    np.fill_diagonal(S, -2)
    S[fid[:, None] == fid[None, :]] = -2
    ok = wrong = 0
    for i in range(len(E)):
        o = np.argsort(-S[i])[:k]
        o = o[S[i, o] >= th]
        if len(o) == 0:
            continue
        w = {}
        for j in o:
            w[lab[j]] = w.get(lab[j], 0) + S[i, j]
        b = max(w, key=w.get)
        if w[b] / sum(w.values()) < dom or S[i, o][lab[o] == b].max() < th + strong:
            continue
        if b == lab[i]:
            ok += 1
        else:
            wrong += 1
    n = len(E)
    return ok / n, wrong / n


for key in ("e1", "e2", "e3"):
    E = np.array([r[key] for r in named], dtype=np.float32)
    s = (E @ E.T)[iu]
    all3, t3 = tar_at(s, np.ones_like(same), 1e-3)
    all4, t4 = tar_at(s, np.ones_like(same), 1e-4)
    pose, _ = tar_at(s, hard_pose, 1e-3)
    size, _ = tar_at(s, hard_size, 1e-3)
    print(f"\n{key}: TAR@FAR1e-3={all3:.3f} (thr {t3:.3f})  TAR@FAR1e-4={all4:.3f} (thr {t4:.3f})")
    print(f"    hard pairs @FAR1e-3: side faces={pose:.3f}  small faces={size:.3f}")
    for th in (round(t3 - 0.05, 2), round(t3, 2), round(t3 + 0.05, 2)):
        ok, wrong = loo(E, th)
        print(f"    kNN vote th={th:.2f}: correct={ok*100:.1f}% wrong={wrong*100:.2f}% abstain={(1-ok-wrong)*100:.1f}%")

# Quality signals vs how well a face matches its own person (e3).
E = np.array([r["e3"] for r in named], dtype=np.float32)
S = E @ E.T
np.fill_diagonal(S, -2)
own = np.array([np.sort(S[i][lab == lab[i]])[-3:].mean() for i in range(len(E))])
print("\nquality signal -> mean own-person top-3 similarity (e3), by quartile")
for sig in ("det", "facepx", "blur", "yaw", "n3"):
    v = np.array([r[sig] for r in named])
    qs = np.quantile(v, [0.25, 0.5, 0.75])
    bins = np.digitize(v, qs)
    print(f"  {sig:7s} cuts={np.round(qs, 3).tolist()} own-sim by quartile={[round(float(own[bins == b].mean()), 3) for b in range(4)]}")
