#!/bin/sh
set -eu

if docker compose version >/dev/null 2>&1; then
  docker compose logs -f postgres redis
  exit 0
fi

if command -v docker-compose >/dev/null 2>&1; then
  docker-compose logs -f postgres redis
  exit 0
fi

docker logs -f vizitum-postgres &
postgres_logs_pid=$!
docker logs -f vizitum-redis &
redis_logs_pid=$!

trap 'kill "$postgres_logs_pid" "$redis_logs_pid" 2>/dev/null || true' INT TERM EXIT
wait
