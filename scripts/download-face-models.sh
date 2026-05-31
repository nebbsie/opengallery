#!/usr/bin/env bash
# Download the InsightFace `buffalo_l` model pack (SCRFD detector + ArcFace
# w600k_r50 recognition) used by the face-service sidecar. Extracts into the
# InsightFace model home so FaceAnalysis(name='buffalo_l') finds it offline.
#
#   bash scripts/download-face-models.sh
#
# Override the source with FACE_MODELS_URL (e.g. an internal mirror).
set -euo pipefail

PACK_URL="${FACE_MODELS_URL:-https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip}"
INSIGHTFACE_HOME="${INSIGHTFACE_HOME:-$HOME/.insightface}"
DEST="${INSIGHTFACE_HOME}/models/buffalo_l"

mkdir -p "$DEST"

echo "Downloading InsightFace buffalo_l -> $DEST"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$PACK_URL" -o "$tmp/buffalo_l.zip"
# The zip contains the .onnx files directly; flatten into DEST.
unzip -o -j "$tmp/buffalo_l.zip" -d "$DEST" >/dev/null

echo "Done. Models in $DEST:"
ls -1 "$DEST"
