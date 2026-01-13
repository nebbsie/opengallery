#!/bin/bash

# Local run script for OpenGallery
# Builds the unified Docker image and runs it locally

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="opengallery-local"
CONTAINER_NAME="opengallery-local"

# Default paths (can be overridden with environment variables)
DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/Pictures}"

echo "=========================================="
echo "OpenGallery Local Build & Run"
echo "=========================================="
echo "Data directory: $DATA_DIR"
echo "Media directory: $MEDIA_DIR"
echo ""

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Stop and remove existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping existing container..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

# Build the unified image
echo "Building Docker image..."
docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile.unified" "$SCRIPT_DIR"

echo ""
echo "Starting container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p 3219:3219 \
    -p 4321:4321 \
    -v "$DATA_DIR:/data" \
    -v "$MEDIA_DIR:/host/media:ro" \
    -e INTERNAL_TOKEN=local-dev-token \
    -e TRUSTED_ORIGINS="http://localhost:4321,http://127.0.0.1:4321" \
    "$IMAGE_NAME"

echo ""
echo "=========================================="
echo "OpenGallery is starting!"
echo "=========================================="
echo ""
echo "  Web UI:  http://localhost:4321"
echo "  API:     http://localhost:3219"
echo ""
echo "  Media mounted from: $MEDIA_DIR"
echo "  Data stored in: $DATA_DIR"
echo ""
echo "Commands:"
echo "  View logs:    docker logs -f $CONTAINER_NAME"
echo "  Stop:         docker stop $CONTAINER_NAME"
echo "  Remove:       docker rm $CONTAINER_NAME"
echo ""
