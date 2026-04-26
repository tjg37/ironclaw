---
name: reset
description: Reset IronClaw — stops services and wipes the database (with confirmation)
---

# /reset — Reset IronClaw

Completely reset IronClaw to a clean state. **This is destructive — all data will be lost.**

## Steps

1. Warn the user: "This will stop all services and permanently delete the database (sessions, messages, memories, agent config). Are you sure? (yes/no)"

2. **Only proceed if the user confirms with "yes".**

3. Stop any running processes — remind user to Ctrl+C any `pnpm start` / `pnpm start:all` processes

4. Stop Docker services and remove volumes:
   ```bash
   docker compose -f docker-compose.dev.yml down -v
   ```

5. Confirm: "IronClaw has been reset. Run `/setup` to start fresh."
