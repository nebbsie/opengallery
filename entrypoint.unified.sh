#!/usr/bin/env sh
set -eu

echo "============================================"
echo "OpenGallery Unified Container Starting..."
echo "============================================"

# Create data directories if they don't exist
mkdir -p /data/uploads
mkdir -p /var/log/opengallery
mkdir -p /var/log/supervisor

# INTERNAL_TOKEN gates internal tRPC procedures and /metrics, and nginx exposes
# the API under /api/. The image default "changeme" is public, so replace it
# (or an empty value) with a random token. supervisord passes it to the api
# and worker, which are the only users of it inside the container.
if [ -z "${INTERNAL_TOKEN:-}" ] || [ "${INTERNAL_TOKEN}" = "changeme" ]; then
  INTERNAL_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  export INTERNAL_TOKEN
  echo "INTERNAL_TOKEN not set (or 'changeme'); generated a random token for this run."
fi

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
