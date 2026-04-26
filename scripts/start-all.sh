#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Starting Docker services..."
docker compose -f docker-compose.dev.yml up -d

echo "⏳ Waiting for Postgres to be healthy..."
pg_ready=false
for _ in {1..30}; do
  if docker compose -f docker-compose.dev.yml ps postgres 2>/dev/null | grep -q healthy; then
    pg_ready=true
    break
  fi
  sleep 1
done

if [ "$pg_ready" = false ]; then
  echo "❌ Postgres did not become healthy within 30 seconds."
  echo "   Check: docker compose -f docker-compose.dev.yml logs postgres"
  exit 1
fi

docker exec ironclaw-postgres-1 psql -U ironclaw -d ironclaw -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true

echo "📦 Running migrations..."
pnpm db:migrate

echo "🚀 Starting all services..."
npx concurrently \
  --names "gateway,runtime,web" \
  --prefix-colors "blue,green,magenta" \
  --kill-others-on-fail \
  "pnpm start:gateway" \
  "pnpm start:runtime" \
  "pnpm start:web"
