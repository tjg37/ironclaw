---
name: setup
description: Interactive setup for IronClaw — checks prerequisites, starts services, configures auth and agent persona
---

# /setup — IronClaw Setup

Walk the user through setting up IronClaw from scratch.

**IMPORTANT:** Use the `AskUserQuestion` tool for ALL user choices. This renders clickable options instead of requiring the user to type. Never ask the user to "pick a number" or type a selection — always use AskUserQuestion with appropriate options.

## Step 1: Check Prerequisites

- Check Node.js version: run `node --version`
- If Node.js is missing or below v22:
  - Try `nvm install` (which reads `.nvmrc`) then `nvm use`
  - If nvm is not available, tell the user: "Node.js 22+ is required. Please install it (e.g., using Node Version Manager with `nvm install`) or from https://nodejs.org, then re-run `/setup`."
  - Stop setup if Node.js 22+ cannot be activated
- Verify pnpm is available (`pnpm --version`). If missing, run `corepack enable && corepack prepare pnpm@latest --activate`
- Verify Docker is running (`docker info`)
- If Docker is not running, tell the user to start Docker Desktop and re-run `/setup`

## Step 2: Install Dependencies

- Run `pnpm install` from the project root
- Verify it completes without errors

## Step 3: Start Infrastructure

- Check if Docker Compose services are already running: `docker compose -f docker-compose.dev.yml ps`
- If not running, start them: `docker compose -f docker-compose.dev.yml up -d`
- Wait for Postgres to be healthy
- Enable pgvector: `docker exec ironclaw-postgres-1 psql -U ironclaw -d ironclaw -c "CREATE EXTENSION IF NOT EXISTS vector;"`

## Step 4: Authentication

Use AskUserQuestion (single select) with:
- **Claude Code Max plan** — "Use your existing Claude subscription credits"
- **Anthropic API key** — "Use a separate API key"

**If user picks Max plan:**
- Run `claude auth status` to verify they're authenticated
- If not authenticated, tell them to run `claude auth login` first and come back
- Append `AUTH_MODE=max_plan` to `.env` (create if needed)
- Do NOT ask for or set ANTHROPIC_API_KEY

**If user picks API key:**
- Check if `ANTHROPIC_API_KEY` is already set in `.env`
- If not, ask for their key and append to `.env`
- Append `AUTH_MODE=api_key` to `.env`
- Remind the user that `.env` is in `.gitignore`

## Step 5: Run Database Migrations

- Run `pnpm db:migrate`
- Verify it completes with "Migrations complete."

## Step 6: Configure Your Agent

Use AskUserQuestion for each selection below.

### Persona

Use AskUserQuestion (single select) with question "What kind of assistant do you want?":
- **General assistant** — "Good at everything (default)"
- **Developer assistant** — "Code, debugging, architecture"
- **Research assistant** — "Thorough research, citations, analysis"
- **Personal organizer** — "Tasks, scheduling, reminders"

Note: AskUserQuestion supports max 4 options. Present the first 4, then if the user selects "Other", present a second question with the remaining options:
- **Writing assistant** — "Content creation, editing, copywriting"
- **Data analyst** — "Data exploration, SQL, visualizations"
- **DevOps / SRE** — "Infrastructure, deployment, monitoring"
- **Product manager** — "Requirements, specs, user stories"

The user can also type a custom description via the "Other" option on either question. If they do, set persona to "custom" and store their text in `customPersona`.

### Boundaries

Use AskUserQuestion (multi-select) with question "Which capabilities should be enabled?":
- **Run bash commands** — "Execute shell commands"
- **Write/edit files** — "Create and modify files"
- **Web search** — "Search the internet for information"
- **Read system files** — "Access files outside the project directory"

All should be selected by default. Items the user deselects become `false` in boundaries.

### MCP Connections

Use AskUserQuestion (multi-select) with question "Which integrations do you want enabled?":
- **Memory (built-in)** — "Persistent long-term memory (recommended)"
- **GitHub (set GITHUB_TOKEN)** — "Read issues, open PRs, search repos. Requires a GitHub personal access token in .env."
- **Sentry (set SENTRY_AUTH_TOKEN)** — "List issues, inspect events. Requires a Sentry auth token in .env."

The `memory` MCP is enabled in-process via `mcpConnections`. **GitHub and Sentry MCPs are gated by environment variables, not by `mcpConnections`** — selecting them here is informational, the actual enablement happens when the corresponding token is present in `.env` at runtime.

If the user selects GitHub or Sentry but the corresponding token is not set in `.env`, tell them after saving the config:

> "GitHub/Sentry will activate once you add `GITHUB_TOKEN=ghp_…` (or `SENTRY_AUTH_TOKEN=sntrys_…`) to your `.env` and restart IronClaw. See the README's [Adding integrations](../../README.md#adding-integrations) section for the full walkthrough."

### Save Configuration

Save the config by running from the shared package directory:

```bash
cd packages/shared && node --env-file=../../.env --import tsx/esm -e "
import { agentRepo } from './src/index.js';
const tenant = await agentRepo.findOrCreateDefaultTenant();
const agent = await agentRepo.findOrCreateDefaultAgent(tenant.id);
await agentRepo.updateAgentConfig(agent.id, {
  persona: 'CHOSEN_PERSONA',
  customPersona: 'CUSTOM_TEXT_OR_UNDEFINED',
  boundaries: {
    allowBash: BOOL,
    allowFileWrites: BOOL,
    allowWebSearch: BOOL,
    allowSystemFiles: BOOL
  },
  mcpConnections: ['memory']
});
console.log('Agent configured!');
process.exit(0);
"
```

Replace the placeholder values with the user's actual choices. Omit `customPersona` if persona is not "custom".

## Step 7: Verify

Show a summary:
- Auth mode: Max plan / API key
- Persona: (chosen persona)
- Boundaries: list enabled/disabled
- MCP: list active connections

Then show how to start:
- **CLI mode**: `pnpm start`
- **Full stack (one terminal)**: `pnpm start:all`
- **Full stack (separate terminals)**: `pnpm start:gateway`, `pnpm start:runtime`, `pnpm start:web`

Mention they can run `/configure` anytime to change agent settings.

## Notes

- Postgres runs on port **5433** (not 5432) to avoid conflicts
- NATS runs on port 4222 with JetStream enabled
- The default model is `claude-sonnet-4-20250514` — override with `ANTHROPIC_MODEL` env var
- Web app runs on port 3000 at http://localhost:3000
