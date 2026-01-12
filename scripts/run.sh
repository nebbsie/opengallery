#!/usr/bin/env bash

docker pull ghcr.io/nebbsie/opengallery:latest

docker run -d \
  -p 3219:3219 -p 4321:4321 \
  -v opengallery-data:/data \
  -v /:/host:ro \
  -e INTERNAL_TOKEN=your-secret-token \
  ghcr.io/nebbsie/opengallery:latest    




