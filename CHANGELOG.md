# Changelog

All notable changes to IronClaw are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-23

Initial public release.

### Highlights

- **Multi-agent runtime** on the Claude Agent SDK. Each agent has its own persona, trust level, and MCP configuration.
- **Channels:** web chat, CLI, and Telegram. Inbound messages route through a NATS message bus; outbound responses stream back to the originating channel.
- **Approval flow:** tool calls from non-operator channels pause on an approval queue. The operator approves or denies from the web UI (`/approvals`), and the agent resumes.
- **MCP integrations:** GitHub (HTTP bearer to `api.githubcopilot.com/mcp`) and Sentry (stdio via `@sentry/mcp-server`). Register new stdio or HTTP MCPs via `EXTERNAL_MCP_FACTORIES` in the runtime.
- **Skills:** Claude Code user-invocable commands exposed to agents (`/add-agent`, `/configure`, `/reset`, `/setup`, `/start`, `/stop`, `/add-telegram`, `/add-remote-access`, `/switch-agent`).
- **Cron scheduling:** per-agent cron jobs with their own prompt, schedule, and per-fire session keys. Manage from the web UI (`/crons`) or via the `cron_manage` tool.
- **Memory system:** hybrid vector + keyword search with per-agent isolation, embedded via the memory MCP.
- **Observability:** session history, per-session tool-execution timeline, and filters for type / status / agent / search on the `/history` page.
- **Per-conversation sessions:** each chat can live in its own session key; history pages can resume a past conversation in chat.
- **Trust levels:** `operator` (web + CLI), `trusted`, and `untrusted` (Telegram). The approval hook gates tool calls at runtime based on trust level and per-tool policy.

### Known limits (tracked for v1.1+)

- Web Push / PWA support — Telegram is the push channel for v0.1
- OAuth-based hosted MCPs (e.g., `mcp.sentry.dev`, Atlassian) — stdio + static-bearer only in v0.1
- UI-driven cron editing — create/edit via the default agent's `cron_manage` tool for now
- Approval retry queue for denied tool calls
- Alternative model providers — Anthropic only in v0.1

### Internal

- PostgreSQL + Drizzle ORM for durable state
- NATS for channel-runtime messaging
- Next.js 15 + React 19 web UI
- Vitest for unit + integration tests

[0.1.0]: https://github.com/tjg37/ironclaw/releases/tag/v0.1.0
