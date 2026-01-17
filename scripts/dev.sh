#!/bin/bash

# Dev mode runner for OpenGallery monorepo
# Starts API, Worker, and Web services concurrently

echo "Starting OpenGallery in dev mode..."

# Function to handle cleanup on exit
cleanup() {
    echo "Stopping services..."
    kill 0
}

trap cleanup SIGINT SIGTERM

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the repo root (parent of scripts directory)
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"


npm run migrate

# Start API
echo "Starting API..."
(cd "$REPO_ROOT/api" && npm run start) &
API_PID=$!

# Wait for API to start up
echo "Waiting for API to initialize..."
sleep 5

# Start Worker
echo "Starting Worker..."
(cd "$REPO_ROOT/worker" && npm run dev) &
WORKER_PID=$!

# Start Web
echo "Starting Web..."
(cd "$REPO_ROOT/web" && npm start) &
WEB_PID=$!

echo "All services started. Press Ctrl+C to stop."

# Wait for all processes
wait $API_PID $WORKER_PID $WEB_PID
