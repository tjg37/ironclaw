# How IronClaw compares

IronClaw sits between [OpenClaw](https://github.com/nicholasgriffintn/OpenClaw) (full-featured agent OS) and [NanoClaw](https://github.com/nicholasgriffintn/NanoClaw) (minimal fork-and-customize agent). [NemoClaw](https://github.com/nicholasgriffintn/NemoClaw) is a lightweight alternative that prioritizes simplicity.

| Dimension | OpenClaw | NanoClaw | NemoClaw | IronClaw |
|---|---|---|---|---|
| **Philosophy** | Full-featured agent OS for power users | Minimal, understandable, fork-and-customize | Lightweight, single-file simplicity | Lean but extensible, security-first, AI-native management |
| **Codebase size** | ~434K LOC, 3,680 files, 70+ deps | ~4K LOC, 15 files | ~500 LOC, single entry point | ~13K LOC, 162 files (across 4 packages) |
| **Understandability** | Days to comprehend | 8 minutes to read | 5 minutes to read | A couple of hours — SDK handles most complexity |
| **Process model** | Single monolithic Node.js process | Single Node.js process | Single Node.js process | Separate Gateway + Runtime via NATS |
| **Database** | JSON files + SQLite | SQLite | In-memory / flat files | PostgreSQL + pgvector |
| **Memory** | SQLite with vector embeddings, hybrid search | CLAUDE.md files per group | None (stateless) | pgvector hybrid search + per-group CLAUDE.md files |
| **Agent runtime** | Pi Agent Core (custom RPC) | Claude Agent SDK | Direct LLM API calls | Claude Agent SDK |
| **Security model** | Application-level (allowlists, pairing codes, optional Docker) | OS-level (container isolation is primary boundary) | Minimal (single-user assumption) | Both: OS-level container isolation + SDK hooks for approval and audit |
| **Container isolation** | Optional | Mandatory | None | Mandatory for non-main, hardened (read-only source, mount allowlist, ephemeral) |
| **Tool permissions** | Layered policy | Whatever the container can access | N/A | SDK hooks (PreToolUse/PostToolUse) + container boundary |
| **Approval queue** | No (auto-executes tools) | No (auto-executes within container) | No | Yes — destructive operations require human confirmation |
| **Credential management** | Environment variables, local files | Environment variables | Environment variables | AES-256-GCM encrypted in Postgres with scoped access |
| **Skill system** | ZIP files + community hub (ClawHub) | Claude Code skills that modify your fork | None | Claude Code skills + in-process MCP servers |
| **Channels** | 15+ built-in (WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Teams, etc.) | WhatsApp primary, others via skills | CLI only | Web + CLI + Telegram built-in, others via adapters |
| **Setup experience** | CLI wizard (`openclaw onboard`) | `claude` then `/setup` | `npm start` | `claude` then `/setup` |
| **Management interface** | Web UI dashboard, CLI commands | Ask Claude Code | CLI output | AI-native (ask the agent) + web UI (chat, history, crons, approvals) |
| **Scheduled jobs** | Config-based cron | Built-in task scheduler | None | node-cron in Gateway, jobs stored in Postgres |
| **Multi-user** | Single user (multi-agent routing for isolation) | Single user | Single user | Single operator by design |
| **Observability** | Basic health checks | Ask Claude Code | None | Per-session tool-execution timeline, audit logs, AI-native metrics tools |
| **Model flexibility** | Claude, OpenAI, Gemini, local models | Claude Agent SDK (Anthropic-compatible endpoints) | Multiple LLM providers | Anthropic only (v0.1) |
| **Voice** | ElevenLabs wake word + TTS on macOS/iOS/Android | No | No | No |
| **Cost** | Free + LLM API costs | Free + Claude Code subscription + LLM API costs | Free + LLM API costs | Free + LLM API costs |
| **License** | MIT | MIT | MIT | MIT |
| **Maturity** | Production, large community | Growing, active community | Early stage | v0.1 — initial public release |

## When to choose IronClaw

- You want an agent that runs on your own infrastructure and can act across services (GitHub, Sentry, Telegram, etc.)
- You want human-in-the-loop control for destructive operations, not auto-execution
- You're comfortable with a Node.js + Postgres + NATS stack
- You want to extend the agent with your own MCPs, skills, and channels

## When to choose something else

- **OpenClaw** — if you need 15+ channels out of the box and don't mind a larger codebase
- **NanoClaw** — if you want the minimal, fork-and-read-the-whole-thing approach with mandatory container isolation
- **NemoClaw** — if you want a single-file agent with multiple model provider support and no persistence
