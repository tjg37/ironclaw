<p align="center">
  <img src="packages/web/public/ironclaw-logo.png" alt="IronClaw" width="320" />
</p>

<h3 align="center">Your personal AI agent sidekick.</h3>
<p align="center">
  Self-hosted, multi-channel, with approval gating built in.
</p>

<p align="center">
  <a href="https://github.com/tjg37/ironclaw/actions/workflows/ci.yml"><img src="https://github.com/tjg37/ironclaw/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href=".nvmrc"><img src="https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg" alt="Node 22+"></a>
  <a href="https://github.com/anthropics/claude-agent-sdk-typescript"><img src="https://img.shields.io/badge/built%20with-Claude%20Agent%20SDK-6f42c1.svg" alt="Built with Claude Agent SDK"></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome"></a>
</p>

---

## What is IronClaw?

IronClaw is a personal AI agent platform you run on your own machine. It's built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — the same engine that powers Claude Code — and adds the pieces you need to live with an agent day to day:

- **Multi-channel access** — chat from a web UI on your laptop or phone, from the CLI, or from Telegram
- **Approval gating** — tool calls from untrusted channels pause until you approve them from the web UI
- **Persistent memory** — hybrid vector + keyword search, per-agent isolation, stored in Postgres
- **MCP-native** — ships with GitHub and Sentry integrations; add your own stdio or HTTP MCPs in a few lines
- **Cron scheduling** — run agents on a schedule for recurring tasks (e.g., watch Sentry, open PRs, summarize your inbox)
- **Multi-agent** — each agent has its own persona, trust level, model, and MCP config; agents can delegate to each other

IronClaw is for people who want an AI agent that acts on their behalf across services — and want the keys, logs, and kill switch to stay on their own infrastructure.

## Screenshot

<p align="center">
  <img src="docs/screenshots/screenshot.png" alt="IronClaw web UI" width="900" />
</p>

## Features

- **Chat** — streaming responses, tool status indicators, GFM markdown with code/diff highlighting, per-conversation sessions
- **History** — filter by type / status / agent, full-text search, resume any past conversation, tool-execution timeline per session
- **Approvals** — pending tool calls across all agents and channels, approve or deny with one click
- **Agents** — create, configure, and switch between agents; each with their own persona, boundaries, model, and MCP config
- **Crons** — manage scheduled jobs from the web UI or by asking the agent (`"list my cron jobs"`, `"create a cron that runs every 5 minutes"`)
- **Remote access** — private access from your phone via [Tailscale](https://tailscale.com) (see `/add-remote-access`)
- **Theming** — light by default, automatically follows system dark mode

## Quick start

### Prerequisites

- **Node.js 22+** (see `.nvmrc`). If you use [nvm](https://github.com/nvm-sh/nvm), run `nvm use` from the repo root to pick up the pinned version even if your default Node is newer or older.
- **Docker** (for Postgres and NATS)
- **[Claude Code](https://claude.com/claude-code) CLI** (for the guided setup flow)
- An **[Anthropic API key](https://console.anthropic.com/)** or a **[Claude Code Max](https://claude.com/claude-code)** subscription

### Recommended: guided setup via Claude Code

```bash
git clone https://github.com/tjg37/ironclaw.git
cd ironclaw
nvm use         # if you use nvm — picks up Node 22 from .nvmrc
claude
```

Then inside Claude Code:

```
/setup
```

Claude Code walks you through dependencies, database, authentication, and agent configuration (persona, boundaries, MCP connections) with clickable menus.

> Heads up: `pnpm install` may print "Update available" and "Ignored build scripts: sharp" — both are expected and safe to ignore.

After `/setup` finishes, see [Adding integrations](#adding-integrations) below to enable optional MCPs (GitHub, Sentry) via environment variables.

### Manual setup

```bash
nvm install && nvm use                                    # Node 22+
corepack enable && corepack prepare pnpm@latest --activate
pnpm install

docker compose -f docker-compose.dev.yml up -d            # Postgres + NATS
docker exec ironclaw-postgres-1 psql -U ironclaw -d ironclaw \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"             # pgvector (first time)

pnpm db:migrate
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env               # or AUTH_MODE=max_plan

pnpm start:all                                            # Gateway + Runtime + Web
```

Open <http://localhost:3000> for the web interface.

### Running modes

| Command | What it does |
|---------|--------------|
| `pnpm start` | CLI only, no Gateway/NATS |
| `pnpm start:all` | Gateway + Runtime + Web in one terminal |
| `pnpm start:gateway` | Gateway alone (WebSocket + HTTP, port 18789) |
| `pnpm start:runtime` | Runtime worker alone (consumes NATS) |
| `pnpm start:web` | Web app alone (port 3000) |

## Adding integrations

### New channel: Telegram

```
/add-telegram
```

Walks you through creating a bot with @BotFather, storing the token, and pairing your Telegram account with the operator.

### New MCP: GitHub

Add a GitHub personal access token to `.env`:

```
GITHUB_TOKEN=ghp_...
```

Restart IronClaw. The agent picks up the `github` MCP automatically (via `api.githubcopilot.com/mcp`) and can now read issues, open PRs, review code, and search repos.

### New MCP: Sentry

Add a Sentry auth token to `.env`:

```
SENTRY_AUTH_TOKEN=sntrys_...
```

Restart. The agent picks up the `sentry` MCP (stdio via `@sentry/mcp-server`) and can list issues, inspect events, and query replays.

### New agent

```
/add-agent
```

Creates an agent with its own persona, trust level, model, and MCP config. Switch between agents with `/switch-agent` or the dropdown in the web UI.

### Custom MCPs

Register a factory in `EXTERNAL_MCP_FACTORIES` in `packages/runtime/src/sdk-agent.ts`. Both stdio and HTTP-bearer transports are supported. See [CONTRIBUTING.md](./CONTRIBUTING.md#extension-points) for the full guide.

## Skills and agent tools

IronClaw is managed through two layers: **Claude Code skills** (run in Claude Code) and **agent tools** (ask the agent in any channel).

### Claude Code skills

| Skill | What it does |
|-------|--------------|
| `/setup` | First-time setup |
| `/start` | Start IronClaw |
| `/stop` | Stop Docker services |
| `/reset` | Wipe the database and start fresh |
| `/add-agent` | Create a new agent |
| `/switch-agent` | Switch active agent |
| `/configure` | Change an agent's persona, boundaries, or MCPs |
| `/add-telegram` | Set up Telegram access |
| `/add-remote-access` | Set up Tailscale remote access |
| `/security-audit` | Audit encryption, tokens, mounts, sandbox |

### Ask the agent

Once running, the agent has its own management tools. Just ask in any channel:

- `"What's your current config?"`
- `"List all agents"`
- `"Create a cron that runs every hour and checks for new Sentry issues"`
- `"What's my usage this week?"`
- `"Show recent tool logs"`

## Architecture

```
┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐
│  Telegram  │───▶│  Gateway   │───▶│    NATS    │───▶│  Runtime   │───▶│  Postgres  │
│ Web / CLI  │    │ (WS/HTTP)  │    │            │    │   (SDK)    │    │ (pgvector) │
└────────────┘    └─────┬──────┘    └────────────┘    └─────┬──────┘    └────────────┘
                        │                                   │
                        ▼                                   ▼
                  ┌────────────┐                      MCP servers
                  │   Web UI   │                      (github, sentry,
                  │(Next.js 15)│                       memory, …)
                  └────────────┘
```

Key architectural decisions are documented in [docs/decisions/](./docs/decisions/).

## Limits in v0.1

Known things IronClaw does **not** do yet:

- **Anthropic models only** — no OpenAI, Gemini, or local models (provider abstraction is a potential v1.x direction)
- **Web Push / PWA** — Telegram is the push channel for v0.1; browser push is tracked for v1.1
- **OAuth-based hosted MCPs** — only stdio and static-bearer HTTP MCPs in v0.1 (OAuth MCPs like `mcp.sentry.dev`, Atlassian are tracked for v1.1)
- **UI cron editing** — create/edit crons via the agent (`cron_manage`); the web UI is read-only for v0.1
- **Approval retry queue** — denied tool calls don't surface as retry-able items yet
- **Multi-user / multi-tenant** — single-operator by design (agents are scoped per-operator; no multi-user auth layer)

See [CHANGELOG.md](./CHANGELOG.md) for the full v0.1 release notes.

## Roadmap

Short-term priorities:

- Web Push + PWA for browser-based notifications
- OAuth-based hosted MCPs (e.g., `mcp.sentry.dev`, Atlassian)
- UI-based cron editor
- Approval retry queue
- Bump runtime to Node 24 + latest pnpm

Longer-term items live on the [issues page](https://github.com/tjg37/ironclaw/issues?q=is%3Aissue+label%3Aroadmap) under the `roadmap` label. Upvote with reactions; propose new items via a new issue. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening large PRs.

## Configuration reference

All config is read from `.env` in the project root.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_MODE` | `api_key` | `api_key` or `max_plan` |
| `ANTHROPIC_API_KEY` | (required if api_key) | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Main conversational model |
| `ANTHROPIC_FAST_MODEL` | `claude-haiku-4-5-20251001` | Fast model (extraction, compaction) |
| `VOYAGE_API_KEY` | (optional) | Voyage AI key for memory embeddings |
| `IRONCLAW_NOTES_DIR` | `~/ironclaw-notes` | Directory for agent notes |
| `DATABASE_URL` | `postgres://ironclaw:dev_password@localhost:5433/ironclaw` | Postgres URL |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `GATEWAY_PORT` | `18789` | Gateway port |
| `GATEWAY_WS_TOKEN` | (recommended) | WebSocket shared secret |
| `TELEGRAM_BOT_TOKEN` | (optional) | From @BotFather |
| `TELEGRAM_OPERATOR_ID` | (optional) | From @userinfobot |
| `GITHUB_TOKEN` | (optional) | Enables the GitHub MCP |
| `SENTRY_AUTH_TOKEN` | (optional) | Enables the Sentry MCP |
| `NEXT_PUBLIC_GATEWAY_URL` | `ws://localhost:18789` | Web gateway URL |
| `NEXT_PUBLIC_GATEWAY_TOKEN` | (optional) | Must match `GATEWAY_WS_TOKEN` |
| `IRONCLAW_WEB_PASSWORD` | (recommended) | Web login password |
| `IRONCLAW_SESSION_SECRET` | (optional) | Cookie signing secret |

## Project layout

```
ironclaw/
├── packages/
│   ├── shared/      # DB schema, repositories, embeddings
│   ├── runtime/     # Agent loop, tools, MCP factories, channels, cron
│   ├── gateway/     # WebSocket/HTTP server, approval endpoints
│   └── web/         # Next.js 15 web app
├── .claude/skills/  # Claude Code skills (/setup, /add-agent, ...)
├── docker-compose.dev.yml
└── docs/            # Architecture decisions
```

## Contributing

PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

Found a security issue? Please email me instead of filing a public issue — see [SECURITY.md](./SECURITY.md).

## How IronClaw compares

| | OpenClaw | NanoClaw | IronClaw |
|---|---|---|---|
| **Philosophy** | Full-featured agent OS | Minimal fork-and-customize | Lean but extensible, security-first |
| **Codebase** | ~434K LOC, 3,680 files | ~4K LOC, 15 files | ~13K LOC, 162 files |
| **Agent runtime** | Pi Agent Core (custom RPC) | Claude Agent SDK | Claude Agent SDK |
| **Database** | SQLite + JSON | SQLite | PostgreSQL + pgvector |
| **Approval queue** | No (auto-executes) | No (container-sandboxed) | Yes — per-tool, per-trust-level |
| **Multi-channel** | 15+ built-in | WhatsApp primary | Web + CLI + Telegram built-in |
| **Scheduled jobs** | Config-based cron | Built-in task scheduler | node-cron in gateway, Postgres-backed |
| **License** | MIT | MIT | MIT |

For a fuller comparison, see [docs/comparisons.md](./docs/comparisons.md).

## License

[MIT](./LICENSE) © 2026 Terence Goldberg
