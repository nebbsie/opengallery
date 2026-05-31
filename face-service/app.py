"""
OpenGallery face-recognition sidecar.

State-of-the-art face detection + recognition using InsightFace `buffalo_l`
(SCRFD detector + ArcFace w600k_r50, 512-d embeddings). Runs CPU-only inside the
unified container; the Node worker posts an (already oriented + downscaled) image
and gets back per-face boxes + L2-normalized embeddings to cluster.

Endpoints:
  GET  /health  -> {"status": "ok", "model": "buffalo_l"} once the model is loaded
  POST /detect  -> multipart form field `image` (JPEG/PNG bytes)
                   {"faces": [{"bbox":[x1,y1,x2,y2], "kps":[[x,y]*5],
                               "detScore": float, "embedding":[512 floats]}],
                    "width": int, "height": int}

Embeddings are `face.normed_embedding` (unit length), so cosine similarity is just
the dot product — matching is done in the API (faces.assignFace).
"""

import os

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from insightface.app import FaceAnalysis

# buffalo_l = SCRFD-10GF detection + ArcFace w600k_r50 recognition. We only need
# detection + recognition (skip landmark/genderage extras) to keep CPU cost down.
MODEL_NAME = os.environ.get("FACE_MODEL_NAME", "buffalo_l")
# Detection input size. Larger finds smaller faces at higher CPU cost; matches the
# worker's DETECT_MAX so coordinates line up.
DET_SIZE = int(os.environ.get("FACE_DET_SIZE", "1024"))
# InsightFace model root (expects <root>/models/<name>/*.onnx). Set explicitly so
# it doesn't depend on $HOME under supervisord.
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
        # ctx_id=-1 forces CPU.
        fa.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))
        _analysis = fa
    return _analysis


@app.on_event("startup")
def _warm() -> None:
    # Load + run a tiny dummy frame so the first real request isn't slow.
    fa = get_analysis()
    fa.get(np.zeros((64, 64, 3), dtype=np.uint8))


@app.get("/health")
def health() -> dict:
    loaded = _analysis is not None
    return {"status": "ok" if loaded else "loading", "model": MODEL_NAME}


@app.post("/detect")
async def detect(image: UploadFile = File(...)) -> dict:
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty image")

    buf = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)  # BGR, EXIF already applied upstream
    if img is None:
        raise HTTPException(status_code=400, detail="could not decode image")

    height, width = img.shape[:2]
    faces = get_analysis().get(img)

    out = []
    for f in faces:
        emb = getattr(f, "normed_embedding", None)
        if emb is None:
            continue
        x1, y1, x2, y2 = (float(v) for v in f.bbox)
        out.append(
            {
                "bbox": [x1, y1, x2, y2],
                "kps": f.kps.tolist() if getattr(f, "kps", None) is not None else None,
                "detScore": float(getattr(f, "det_score", 0.0)),
                "embedding": np.asarray(emb, dtype=np.float32).tolist(),
            }
        )

    return {"faces": out, "width": int(width), "height": int(height)}
