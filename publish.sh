#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   GH_PAT=ghp_xxx ./publish.sh

OWNER="nebbsie"
REGISTRY="ghcr.io"
API_IMAGE="$REGISTRY/$OWNER/opengallery-api:latest"
API_MIGRATIONS_IMAGE="$REGISTRY/$OWNER/opengallery-api-migrations:latest"
WEB_IMAGE="$REGISTRY/$OWNER/opengallery-web:latest"

# Login once (requires PAT with write:packages, read:packages)
echo "Logging into $REGISTRY as $OWNER..."
echo "${GH_PAT:?GH_PAT env var is required}" | docker login "$REGISTRY" -u "$OWNER" --password-stdin

# Ensure buildx is ready for multi-arch builds
docker buildx inspect multiarch-builder >/dev/null 2>&1 || docker buildx create --name multiarch-builder --use
docker buildx inspect --bootstrap >/dev/null

echo "Pushing API runtime image → $API_IMAGE"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "$API_IMAGE" \
  -f api/Dockerfile --push ./api

# Push a migrations image from the builder stage so Compose can pull it
echo "Pushing API migrations image (builder stage) → $API_MIGRATIONS_IMAGE"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "$API_MIGRATIONS_IMAGE" \
  -f api/Dockerfile --target builder --push ./api

echo "Pushing Web image → $WEB_IMAGE"
docker buildx build --platform linux/amd64,linux/arm64 \
  -t "$WEB_IMAGE" \
  -f web/Dockerfile --push .

echo "Done. Images pushed:"
echo "  $API_IMAGE"
echo "  $API_MIGRATIONS_IMAGE"
echo "  $WEB_IMAGE"