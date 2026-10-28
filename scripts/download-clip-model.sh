#!/usr/bin/env bash
# Download the image-text (CLIP-style) model used for object search ("red
# car", "teapot") by the face-service sidecar. Immich's ONNX exports on
# Hugging Face; only the files the sidecar reads are fetched.
#
#   bash scripts/download-clip-model.sh                    # ViT-B-16-SigLIP2__webli
#   CLIP_MODEL=ViT-B-32__openai bash scripts/download-clip-model.sh
set -euo pipefail

MODEL="${CLIP_MODEL:-ViT-B-16-SigLIP2__webli}"
CLIP_HOME="${CLIP_HOME:-$HOME/.clip}"
BASE="${CLIP_MODELS_URL:-https://huggingface.co/immich-app/${MODEL}/resolve/main}"
DEST="${CLIP_HOME}/${MODEL}"

for f in visual/model.onnx visual/preprocess_cfg.json textual/model.onnx textual/tokenizer.json config.json; do
  mkdir -p "$(dirname "$DEST/$f")"
  echo "Downloading $MODEL/$f"
  # The text model is about 1.1 GB: retry and resume dropped transfers.
  curl -fsSL --retry 8 --retry-delay 5 --retry-all-errors -C - "$BASE/$f" -o "$DEST/$f"
done
echo "Done. Model in $DEST"
