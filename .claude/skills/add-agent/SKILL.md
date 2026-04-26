---
name: add-agent
description: Create a new IronClaw agent with its own persona, config, and model
---

# /add-agent — Create a New Agent

Create an additional agent alongside the default one. Each agent has its own persona, boundaries, memory, and optionally a different model.

**IMPORTANT:** Use the `AskUserQuestion` tool for all selections.

## Step 1: Name

Ask the user for a name using AskUserQuestion with a few suggestions plus "Other":
- **research-assistant** — "For research and analysis tasks"
- **code-reviewer** — "For code review and debugging"
- **content-writer** — "For writing and editing"

The user can type a custom name via "Other".

## Step 2: Persona

Use AskUserQuestion (single select):
- **General assistant** — "Good at everything"
- **Developer assistant** — "Code, debugging, architecture"
- **Research assistant** — "Thorough research, citations, analysis"
- **Personal organizer** — "Tasks, scheduling, reminders"

If they select "Other", show the remaining options:
- **Writing assistant** — "Content creation, editing"
- **Data analyst** — "Data exploration, SQL, visualizations"
- **DevOps / SRE** — "Infrastructure, deployment, monitoring"
- **Product manager** — "Requirements, specs, user stories"

They can also type a custom persona via "Other" on either question.

## Step 3: Model

Use AskUserQuestion (single select):
- **Default (same as main agent)** — "Uses the model from ANTHROPIC_MODEL env var"
- **Claude Haiku** — "Fast and cheap, good for simple tasks (claude-haiku-4-5-20251001)"
- **Claude Sonnet** — "Balanced performance (claude-sonnet-4-20250514)"
- **Claude Opus** — "Most capable (claude-opus-4-20250514)"

## Step 4: Boundaries

Use AskUserQuestion (multi-select) with question "Which capabilities should be ENABLED?":
- **Run bash commands** — "Execute shell commands"
- **Write/edit files** — "Create and modify files"
- **Web search** — "Search the internet for information"
- **Read system files** — "Access files outside the project directory"

All should be selected by default. Items the user deselects become `false` in boundaries.

## Step 5: MCP Connections

Use AskUserQuestion (multi-select) with question "Which integrations do you want?":
- **Memory (built-in)** — "Persistent long-term memory (recommended)"
- **GitHub** — "Read/write GitHub issues, PRs, code. Requires GITHUB_TOKEN in .env."
- **Sentry** — "Read Sentry issues/events. Requires SENTRY_AUTH_TOKEN in .env."
- **Slack** — "Coming soon"
- **Google Calendar** — "Coming soon"

If the user selects GitHub or Sentry, check `.env` for the matching token (`GITHUB_TOKEN` / `SENTRY_AUTH_TOKEN`). If missing, tell the user the token needs to be added before the agent will actually use that MCP — IronClaw will log a warning and skip the server at runtime. Do NOT block agent creation; the connection stays in config and starts working the moment the token is set.

## Step 6: Create

Run from the shared package directory:

```bash
cd packages/shared && node --env-file=../../.env --import tsx/esm -e "
import { agentRepo } from './src/index.js';
const tenant = await agentRepo.findOrCreateDefaultTenant();
await agentRepo.createAgent(tenant.id, 'AGENT_NAME', {
  persona: 'CHOSEN_PERSONA',
  customPersona: 'CUSTOM_OR_UNDEFINED',
  boundaries: {
    allowBash: BOOL,
    allowFileWrites: BOOL,
    allowWebSearch: BOOL,
    allowSystemFiles: BOOL
  },
  mcpConnections: MCP_CONNECTIONS_ARRAY,
  model: 'MODEL_OR_UNDEFINED'
});
console.log('Agent created!');
process.exit(0);
"
```

Replace placeholder values with the user's actual choices. Omit `customPersona` and `model` if not applicable.

## Step 7: Confirm

Show the created agent's config. Explain how to use it:
- **CLI**: `pnpm start -- --agent AGENT_NAME`
- **Conversationally**: Ask the current agent to "list all agents" to see it
- **Configure**: Run `/configure` to modify the agent's settings
