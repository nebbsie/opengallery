#!/usr/bin/env bash

./delete-dev-infra.sh

docker compose -f ./docker-compose.infra.yml up -d --remove-orphans

