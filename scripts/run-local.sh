#!/bin/bash

# Local run script for OpenGallery
# Builds the unified Docker image and runs it locally

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

# Check if container is running or exists
CONTAINER_EXISTS=$(docker ps -a --filter name="^${CONTAINER_NAME}$" --format "{{.Names}}" | wc -l)
CONTAINER_RUNNING=$(docker ps --filter name="^${CONTAINER_NAME}$" --format "{{.Names}}" | wc -l)

if [ "$CONTAINER_EXISTS" -gt 0 ]; then
    echo "Found existing container: $CONTAINER_NAME"
    if [ "$CONTAINER_RUNNING" -gt 0 ]; then
        echo "Stopping running container..."
        docker stop "$CONTAINER_NAME"
        echo "Container stopped."
    fi
    echo "Removing existing container..."
    docker rm "$CONTAINER_NAME"
    echo "Container removed."
fi

# Build the unified image
echo "Building Docker image..."
docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile.unified" "$SCRIPT_DIR"

echo ""
echo "Starting container..."
docker run -d \
    --name "$CONTAINER_NAME" \
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
echo "  API:     http://localhost:4321/api"
echo ""
echo "  Media mounted from: $MEDIA_DIR"
echo "  Data stored in: $DATA_DIR"
echo ""
echo "Commands:"
echo "  View logs:    docker logs -f $CONTAINER_NAME"
echo "  Stop:         docker stop $CONTAINER_NAME"
echo "  Remove:       docker rm $CONTAINER_NAME"
echo ""
