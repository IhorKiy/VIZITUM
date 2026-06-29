#!/bin/sh
set -eu

if docker compose version >/dev/null 2>&1; then
  docker compose down
  exit 0
fi

if command -v docker-compose >/dev/null 2>&1; then
  docker-compose down
  exit 0
fi

docker stop vizitum-postgres vizitum-redis >/dev/null 2>&1 || true

echo "Local Postgres and Redis are stopped."
