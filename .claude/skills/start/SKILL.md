---
name: start
description: Start IronClaw — ensures Docker services are running, runs migrations if needed, then starts the agent
---

# /start — Start IronClaw

Get IronClaw running with a single command. Handles infrastructure automatically so the user doesn't have to remember Docker commands.

## Step 1: Check Docker services

- Run `docker compose -f docker-compose.dev.yml ps --format json` to check if Postgres and NATS are running
- If either is not running or unhealthy, start them: `docker compose -f docker-compose.dev.yml up -d`
- Wait for Postgres to be healthy: `docker compose -f docker-compose.dev.yml ps` until postgres shows "healthy"
- Ensure pgvector is enabled: `docker exec ironclaw-postgres-1 psql -U ironclaw -d ironclaw -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null`

## Step 2: Run migrations

- Run `pnpm db:migrate` to ensure the database schema is up to date
- This is safe to run repeatedly — it only applies pending migrations

## Step 3: Start the agent

- Ask the user which mode they want:
  - **CLI mode** (default): `pnpm start` — direct conversation, no Gateway/NATS needed
  - **All-in-one mode**: `pnpm start:all` — starts Docker, migrations, then Gateway + Runtime + Web in one terminal with color-coded output
  - **Full mode (separate terminals)**: Tell the user to run:
    - `pnpm start:gateway` (Terminal 1)
    - `pnpm start:runtime` (Terminal 2)
    - `pnpm start:web` (Terminal 3, optional — web app at http://localhost:3000)
- For CLI mode, run `pnpm start` directly

## Notes

- Postgres runs on port **5433** (not 5432) to avoid conflicts
- NATS runs on port **4222** with JetStream enabled
- If `.env` is missing auth config, tell the user to run `/setup` instead
