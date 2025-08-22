docker stop opengallery-api

docker run --rm -p 3219:3219 \
  -e PORT=3219 \
  -e HOST=0.0.0.0 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/opengallery \
  -e TRUSTED_ORIGIN=http://localhost:4321 \
  -e NODE_ENV=production \
  --name opengallery-api \
  opengallery-api:prod
