#!/usr/bin/env bash

docker compose -f ./docker-compose.infra.yml up -d --remove-orphans
