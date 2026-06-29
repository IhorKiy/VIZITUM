#!/bin/sh
set -eu

if docker compose version >/dev/null 2>&1; then
  docker compose up -d postgres redis
  exit 0
fi

if command -v docker-compose >/dev/null 2>&1; then
  docker-compose up -d postgres redis
  exit 0
fi

docker volume create vizitum_postgres_data >/dev/null
docker volume create vizitum_redis_data >/dev/null

if docker ps -a --format '{{.Names}}' | grep -qx 'vizitum-postgres'; then
  docker start vizitum-postgres >/dev/null
else
  docker run -d \
    --name vizitum-postgres \
    --restart unless-stopped \
    -e POSTGRES_DB=vizitum \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -p 5432:5432 \
    -v vizitum_postgres_data:/var/lib/postgresql/data \
    postgres:16-alpine >/dev/null
fi

if docker ps -a --format '{{.Names}}' | grep -qx 'vizitum-redis'; then
  docker start vizitum-redis >/dev/null
else
  docker run -d \
    --name vizitum-redis \
    --restart unless-stopped \
    -p 6379:6379 \
    -v vizitum_redis_data:/data \
    redis:7-alpine >/dev/null
fi

echo "Local Postgres and Redis are starting."
