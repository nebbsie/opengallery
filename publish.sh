#!/usr/bin/env bash

set -euo pipefail

# Usage:
#   GH_PAT=ghp_xxx ./publish.sh

OWNER="nebbsie"
REGISTRY="ghcr.io"
API_IMAGE="$REGISTRY/$OWNER/opengallery-api:latest"
WEB_IMAGE="$REGISTRY/$OWNER/opengallery-web:latest"
WORKER_IMAGE="$REGISTRY/$OWNER/opengallery-worker:latest"

echo "Logging into $REGISTRY as $OWNER..."
echo "${GH_PAT:?GH_PAT env var is required}" | docker login "$REGISTRY" -u "$OWNER" --password-stdin

docker buildx inspect multiarch-builder >/dev/null 2>&1 || docker buildx create --name multiarch-builder --use
docker buildx inspect --bootstrap >/dev/null

echo "Pushing API runtime image → $API_IMAGE"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "$API_IMAGE" \
  -f api/Dockerfile --push .

echo "Pushing Web image → $WEB_IMAGE"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "$WEB_IMAGE" \
  -f web/Dockerfile --push .

echo "Pushing Worker image → $WORKER_IMAGE"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "$WORKER_IMAGE" \
  -f worker/Dockerfile --push .

echo "Done. Images pushed:"
echo "$API_IMAGE"
echo "$WEB_IMAGE"
echo "$WORKER_IMAGE"
