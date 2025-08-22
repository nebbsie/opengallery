docker stop opengallery-web

docker run --rm -p 4321:4321 \
  -e PORT=4321 \
  --name opengallery-web \
  opengallery-web:prod
