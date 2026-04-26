# Contributing to IronClaw

Thanks for your interest in IronClaw. Contributions are welcome — this project is built to be extended, and pull requests that add new agents, skills, MCP integrations, or fix bugs are all in scope.

This is currently a solo-maintained project, so reviews are best-effort. I aim to respond within a week. Please be patient, and don't take quiet inboxes personally.

## Ground rules

- **Open an issue before large features.** A quick "here's what I'm thinking" avoids wasted work when the idea turns out to be out of scope or already in progress. Small bug fixes can skip this step.
- **One logical change per PR.** Easier to review and revert. If a refactor is needed for the fix, it's usually fine in the same PR — just flag it in the description.
- **Tests pass and types check.** `pnpm typecheck && pnpm test` must be green. New behavior should come with tests.
- **No AI-authored PRs without review.** If you used an AI assistant, that's fine — but you're accountable for the code. Read every line before you open the PR.
- **Be respectful.** See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Dev setup

Prerequisites: Node 22+, pnpm 10+, Docker.

```bash
git clone https://github.com/<your-fork>/ironclaw.git
cd ironclaw
pnpm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY at minimum
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm start:all
```

The web UI runs at `http://localhost:3000`. See the [README](./README.md#quick-start) for the full walkthrough.

## Common commands

```bash
pnpm typecheck               # TypeScript check across all packages
pnpm test                    # Unit tests
pnpm test:integration        # Integration tests (requires running Postgres)
pnpm build                   # Production build across all packages
pnpm --filter @ironclaw/web dev    # Just the web UI
```

## Extension points

These are the natural places to add things:

- **New agent** — `/add-agent` skill in Claude Code, or drop a directory under `packages/runtime/agents/`. Each agent has its own persona, trust level, and MCP config.
- **New skill** — Markdown file under `packages/runtime/skills/` with frontmatter. Skills are Claude Code user-invocable commands the agent can expose.
- **New MCP integration** — Register a factory in `EXTERNAL_MCP_FACTORIES` in `packages/runtime/src/sdk-agent.ts`. stdio and HTTP bearer transports are supported; OAuth-based MCPs are tracked for v1.1.
- **New channel** (e.g., Slack, Matrix) — Add an adapter that publishes to the `INBOUND` NATS subject. See `packages/runtime/src/channels/telegram.ts` for the reference implementation.

## PR conventions

- **Title**: short, imperative. Conventional commits welcome but not required.
- **Description**: what changed and why. Link the issue if there is one.
- **Security-sensitive changes** (approval hook, trust levels, credential vault, sandbox): call this out in the description so I review more carefully.

## Reporting vulnerabilities

Please don't file security issues publicly. See [SECURITY.md](./SECURITY.md).

## Scope

IronClaw is opinionated — a personal agent platform with approval gating, multi-channel routing, and MCP integrations. Some things I'm unlikely to merge:

- Alternative model providers baked into the core (a clean provider-abstraction PR is a different conversation)
- Multi-tenant / multi-user auth systems (IronClaw targets a single operator)
- Heavy UI frameworks layered on top of the existing Next.js app

If in doubt, open an issue first. I'd rather have the discussion upfront than close a finished PR.
