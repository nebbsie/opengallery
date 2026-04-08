#!/usr/bin/env bash

set -euo pipefail

# Usage:
#   GH_PAT=ghp_xxx ./publish-unified-dev.sh

OWNER="nebbsie"
REGISTRY="ghcr.io"
IMAGE="$REGISTRY/$OWNER/opengallery:dev"

echo "Logging into $REGISTRY as $OWNER..."
echo "${GH_PAT:?GH_PAT env var is required}" | docker login "$REGISTRY" -u "$OWNER" --password-stdin

docker buildx inspect multiarch-builder >/dev/null 2>&1 || docker buildx create --name multiarch-builder --use
docker buildx inspect --bootstrap >/dev/null

echo "Pushing OpenGallery dev image → $IMAGE"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "$IMAGE" \
  -f Dockerfile.unified --push .

echo "Done. Dev image pushed:"
echo "$IMAGE"
echo ""
echo "To use this image, run:"
echo "  docker pull $IMAGE"
echo "  docker run -p 4321:4321 $IMAGE"
