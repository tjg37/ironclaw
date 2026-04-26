---
name: stop
description: Stop IronClaw — tears down Docker services (Postgres, NATS) cleanly
---

# /stop — Stop IronClaw

Shut down IronClaw's infrastructure services.

## Steps

1. Check which services are running: `docker compose -f docker-compose.dev.yml ps`
2. If services are running, stop them: `docker compose -f docker-compose.dev.yml down`
3. Confirm they've stopped

## Notes

- This stops Postgres and NATS containers but **preserves data** (the `pgdata` volume is not removed)
- To also wipe the database, the user must explicitly ask — then use `docker compose -f docker-compose.dev.yml down -v`
- If the user has `pnpm start`, `pnpm start:gateway`, or `pnpm start:runtime` processes running, remind them to stop those first (Ctrl+C)
