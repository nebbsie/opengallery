#!/usr/bin/env sh
set -eu

echo "============================================"
echo "OpenGallery Unified Container Starting..."
echo "============================================"

# Create data directories if they don't exist
mkdir -p /data/uploads
mkdir -p /var/log/opengallery
mkdir -p /var/log/supervisor

# Run database migrations
echo "Running database migrations..."
cd /app/api
npm run db:migrate || {
  echo "Migrations failed" >&2
  exit 1
}
echo "Migrations complete."

echo "Starting all services via supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
