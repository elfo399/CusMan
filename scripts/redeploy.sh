#!/usr/bin/env sh
set -e

SERVICE="${1:-all}"
NOCACHE_FLAG="${NOCACHE:-false}"

if [ "$SERVICE" = "all" ]; then
  if [ "$NOCACHE_FLAG" = "true" ]; then
    docker compose build --no-cache
  else
    docker compose build
  fi
  docker compose up -d --force-recreate
else
  if [ "$NOCACHE_FLAG" = "true" ]; then
    docker compose build --no-cache "$SERVICE"
  else
    docker compose build "$SERVICE"
  fi
  docker compose up -d --force-recreate "$SERVICE"
fi

docker compose ps
