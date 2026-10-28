#!/usr/bin/env bash
# Download an InsightFace model pack used by the face-service sidecar and
# extract it into the InsightFace model home so FaceAnalysis(name=...) finds it
# offline. Default pack: buffalo_l (SCRFD-10GF detector + ArcFace ResNet50
# trained on WebFace600K). antelopev2 (ResNet100, Glint360K) also works, but
# scored no better on a real library (scripts/face-eval).
#
#   bash scripts/download-face-models.sh            # buffalo_l
#   FACE_MODEL_NAME=antelopev2 bash scripts/download-face-models.sh
#
# Override the source with FACE_MODELS_URL (e.g. an internal mirror).
set -euo pipefail

MODEL_NAME="${FACE_MODEL_NAME:-buffalo_l}"
PACK_URL="${FACE_MODELS_URL:-https://github.com/deepinsight/insightface/releases/download/v0.7/${MODEL_NAME}.zip}"
INSIGHTFACE_HOME="${INSIGHTFACE_HOME:-$HOME/.insightface}"
DEST="${INSIGHTFACE_HOME}/models/${MODEL_NAME}"

mkdir -p "$DEST"

echo "Downloading InsightFace ${MODEL_NAME} -> $DEST"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$PACK_URL" -o "$tmp/${MODEL_NAME}.zip"
# Some packs nest the .onnx files in a folder; flatten into DEST.
unzip -o -j "$tmp/${MODEL_NAME}.zip" '*.onnx' -d "$DEST" >/dev/null
# Only detection + recognition are used; drop the landmark/attribute models.
rm -f "$DEST"/1k3d68.onnx "$DEST"/2d106det.onnx "$DEST"/genderage.onnx

echo "Done. Models in $DEST:"
ls -1 "$DEST"
