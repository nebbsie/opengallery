#!/usr/bin/env bash

# Remove temporary files
rm -rf /tmp/opengallery/

# Stop containers and remove everything including volumes
docker compose -f ./docker-compose.infra.yml down --volumes --remove-orphans

# Start everything fresh
docker compose -f ./docker-compose.infra.yml up -d --remove-orphans
