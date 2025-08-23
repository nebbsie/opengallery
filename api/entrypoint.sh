#!/usr/bin/env sh
set -eu

echo "Running database migrations..."
npm run db:migrate || {
  echo "Migrations failed" >&2
  exit 1
}

echo "Starting server..."
exec node dist/server.js


