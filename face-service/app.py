"""
OpenGallery face-recognition sidecar.

Face detection + recognition with InsightFace model packs (default `buffalo_l`:
SCRFD-10GF detector + ArcFace ResNet50 trained on WebFace600K, 512-d
embeddings). Runs CPU-only inside the unified container.

`antelopev2` (ResNet100, Glint360K) also works (FACE_MODEL_NAME=antelopev2),
but on a real 2,550-face library it was no better (TAR@FAR1e-3 0.935 vs 0.941;
side faces 0.908 vs 0.935) at about 3x the CPU. See scripts/face-eval.

The worker posts the oriented photo at (close to) full resolution. Detection
runs on a downscaled copy (det_size), but each face is aligned and embedded from
the full-resolution pixels, so small faces in big photos still get a sharp
112x112 crop. This matters most for children, group shots and side faces.

Endpoints:
  GET  /health  -> {"status": "ok"|"loading", "model": str}
  POST /detect  -> multipart form field `image` (JPEG/PNG bytes)
                   {"model": str, "width": int, "height": int,
                    "faces": [{"bbox":[x1,y1,x2,y2], "kps":[[x,y]*5],
                               "detScore": float, "facePx": float,
                               "blur": float, "yaw": float, "embNorm": float,
                               "embedding": base64 float32[512] (unit length)}]}
  POST /knn     -> raw body: float32[n*d] unit vectors, then int32[n] group ids
                   query: n, d, k. Returns raw int32[n*k] neighbour indices then
                   float32[n*k] cosine similarities, best first. Rows in the same
                   group (same photo) are never neighbours. Used by the API to
                   regroup all faces (faces/recluster.ts).
"""

import base64
import os

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from insightface.app import FaceAnalysis
from insightface.utils import face_align

MODEL_NAME = os.environ.get("FACE_MODEL_NAME", "buffalo_l")
# Detection input size. The detector downsamples to this internally and maps
# boxes back to the posted image's pixels.
DET_SIZE = int(os.environ.get("FACE_DET_SIZE", "1024"))
# InsightFace model root (expects <root>/models/<name>/*.onnx).
MODEL_ROOT = os.path.expanduser(os.environ.get("INSIGHTFACE_HOME", "~/.insightface"))

app = FastAPI(title="opengallery-face-service")

_analysis: FaceAnalysis | None = None


def get_analysis() -> FaceAnalysis:
    """Load the model once and keep it warm."""
    global _analysis
    if _analysis is None:
        fa = FaceAnalysis(
            name=MODEL_NAME,
            root=MODEL_ROOT,
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        fa.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))
        _analysis = fa
    return _analysis


@app.on_event("startup")
def _warm() -> None:
    fa = get_analysis()
    fa.get(np.zeros((64, 64, 3), dtype=np.uint8))


@app.get("/health")
def health() -> dict:
    loaded = _analysis is not None
    return {"status": "ok" if loaded else "loading", "model": MODEL_NAME}


def _yaw(kps: np.ndarray) -> float:
    """Head turn from the 5 landmarks: nose offset from the eye midpoint along
    the eye axis, relative to the eye distance. Measured along the eye axis
    (not the image x axis), so a tilted head (someone lying down) still reads
    as frontal. 0 = frontal, about 1 = full profile."""
    left_eye, right_eye, nose = kps[0], kps[1], kps[2]
    axis = right_eye - left_eye
    eye_dist = float(np.linalg.norm(axis))
    if eye_dist < 1e-6:
        return 1.0
    mid = (left_eye + right_eye) / 2.0
    along = float(np.dot(nose - mid, axis / eye_dist))
    return abs(along) / eye_dist


@app.post("/detect")
async def detect(image: UploadFile = File(...)) -> dict:
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty image")
    # CPU-bound: run in the threadpool so /health stays responsive.
    return await run_in_threadpool(_detect, raw)


def _detect(raw: bytes) -> dict:
    buf = np.frombuffer(raw, dtype=np.uint8)
    # EXIF orientation is applied upstream (sharp .rotate()); ignore it here so
    # a stray tag cannot rotate the pixels a second time.
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if img is None:
        raise HTTPException(status_code=400, detail="could not decode image")

    height, width = img.shape[:2]
    fa = get_analysis()
    det_model = fa.det_model
    rec_model = fa.models["recognition"]

    bboxes, kpss = det_model.detect(img, max_num=0, metric="default")
    out = []
    if bboxes is None or len(bboxes) == 0:
        return {"model": MODEL_NAME, "width": int(width), "height": int(height), "faces": out}

    for i in range(bboxes.shape[0]):
        x1, y1, x2, y2, score = (float(v) for v in bboxes[i])
        kps = kpss[i] if kpss is not None else None
        if kps is None:
            continue
        # Align from the full-resolution image (kps are in its pixel space).
        aligned = face_align.norm_crop(img, landmark=kps, image_size=112)
        feat = rec_model.get_feat(aligned).flatten().astype(np.float32)
        norm = float(np.linalg.norm(feat))
        if norm == 0:
            continue
        unit = feat / norm
        gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        out.append(
            {
                "bbox": [x1, y1, x2, y2],
                "kps": kps.tolist(),
                "detScore": score,
                "facePx": float(y2 - y1),
                "blur": blur,
                "yaw": _yaw(kps),
                "embNorm": norm,
                "embedding": base64.b64encode(unit.astype("<f4").tobytes()).decode("ascii"),
            }
        )

    return {"model": MODEL_NAME, "width": int(width), "height": int(height), "faces": out}


@app.post("/knn")
async def knn(
    request: Request,
    n: int = Query(..., ge=1),
    d: int = Query(..., ge=1),
    k: int = Query(30, ge=1, le=200),
) -> Response:
    body = await request.body()
    expected = n * d * 4 + n * 4
    if len(body) != expected:
        raise HTTPException(status_code=400, detail=f"expected {expected} bytes, got {len(body)}")
    # CPU-bound: run in the threadpool so /detect and /health stay responsive.
    out = await run_in_threadpool(_knn, body, n, d, k)
    return Response(content=out, media_type="application/octet-stream")


def _knn(body: bytes, n: int, d: int, k: int) -> bytes:
    x = np.frombuffer(body, dtype="<f4", count=n * d).reshape(n, d)
    groups = np.frombuffer(body, dtype="<i4", offset=n * d * 4, count=n)
    k = min(k, max(1, n - 1))

    idx_out = np.zeros((n, k), dtype="<i4")
    sim_out = np.full((n, k), -1.0, dtype="<f4")
    # Small blocks bound memory: each block holds step x n similarities plus
    # the argpartition indices (about 50 MB at step 256 and n = 25k).
    step = 256
    for s in range(0, n, step):
        e = min(n, s + step)
        sims = x[s:e] @ x.T
        # Never link a face to itself or to another face in the same photo.
        sims[groups[s:e, None] == groups[None, :]] = -2.0
        np.negative(sims, out=sims)
        part = np.argpartition(sims, k - 1, axis=1)[:, :k]
        np.negative(sims, out=sims)
        vals = np.take_along_axis(sims, part, axis=1)
        order = np.argsort(-vals, axis=1)
        idx_out[s:e] = np.take_along_axis(part, order, axis=1)
        sim_out[s:e] = np.take_along_axis(vals, order, axis=1)

    return idx_out.tobytes() + sim_out.tobytes()
