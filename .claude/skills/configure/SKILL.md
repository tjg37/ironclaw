---
name: configure
description: Change IronClaw agent configuration — persona, boundaries, and MCP connections
---

# /configure — Reconfigure IronClaw Agent

Change the agent's persona, boundaries, or MCP connections without running full setup. Uses the AskUserQuestion tool for all selections — never ask the user to type numbers or free text (except for custom persona).

## Step 1: Select Agent

First, list all agents to see what's available:

```bash
cd packages/shared && node --env-file=../../.env --import tsx/esm -e "
import { agentRepo } from './src/index.js';
const tenant = await agentRepo.findOrCreateDefaultTenant();
const allAgents = await agentRepo.listAgents(tenant.id);
for (const a of allAgents) {
  const cfg = a.config ?? {};
  console.log(JSON.stringify({ name: a.name, id: a.id, persona: cfg.persona ?? 'general', model: cfg.model ?? 'default' }));
}
process.exit(0);
"
```

If there is more than one agent, use AskUserQuestion to ask which agent to configure. Show each agent's name and persona as options.

If there is only one agent (the default), skip this step and configure it directly.

## Step 2: Load Current Config

Load the selected agent's config:

```bash
cd packages/shared && node --env-file=../../.env --import tsx/esm -e "
import { agentRepo } from './src/index.js';
const config = await agentRepo.getAgentConfig('AGENT_ID');
console.log(JSON.stringify(config, null, 2));
process.exit(0);
"
```

Show the current config to the user as a summary.

## Step 3: Ask What to Change

Use AskUserQuestion with these options:
- **Persona** — change the agent's role
- **Boundaries** — toggle capabilities on/off
- **MCP connections** — manage integrations
- **Allowed agents** — configure which agents this agent can delegate to
- **Everything** — reconfigure all settings

## Step 4: Present Options

**IMPORTANT:** Use the AskUserQuestion tool for ALL selections.

### If changing Persona:

Use AskUserQuestion (single select) with options:
- General assistant — good at everything
- Developer assistant — code, debugging, architecture
- Research assistant — thorough research, citations, analysis
- Personal organizer — tasks, scheduling, reminders

If they select "Other", show remaining options:
- Writing assistant — content creation, editing
- Data analyst — data exploration, SQL, visualizations
- DevOps / SRE — infrastructure, deployment, monitoring
- Product manager — requirements, specs, user stories

They can also type a custom persona via "Other".

### If changing Boundaries:

Use AskUserQuestion (multi-select) with the question "Which capabilities should be ENABLED?":
- Run bash commands
- Write/edit files
- Web search
- Read system files outside project

### If changing MCP Connections:

Use AskUserQuestion (multi-select) with options:
- Memory (built-in) — persistent long-term memory
- GitHub — read/write GitHub issues, PRs, code. Requires `GITHUB_TOKEN` in `.env`.
- Sentry — read Sentry issues/events. Requires `SENTRY_AUTH_TOKEN` in `.env`.
- Slack (coming soon)
- Google Calendar (coming soon)

If the user selects GitHub or Sentry, check `.env` for the matching token. If missing, tell the user the token must be added before the connection activates — IronClaw will log a warning and skip the server at runtime if the token isn't set.

### If changing Allowed Agents:

First, list all other agents so the user can see what's available. Then use AskUserQuestion (multi-select) with the question "Which agents should this agent be allowed to delegate to via ask_agent/tell_agent?". List all other agents by name as options.

**Important security note to show the user:** When this agent delegates to another agent, the delegated agent runs with the **intersection** of both agents' boundaries. This means the delegated agent cannot do anything this agent can't do. For example, if this agent has `allowBash: false`, no delegated agent can use bash on its behalf — even if the delegated agent's own config allows it. Delegation cannot escalate permissions.

If no agents are selected, set `allowedAgents` to `[]` (empty array — no delegation allowed).

## Step 5: Save Configuration

Save the updated config using the selected agent's ID:

```bash
cd packages/shared && node --env-file=../../.env --import tsx/esm -e "
import { agentRepo } from './src/index.js';
await agentRepo.updateAgentConfig('AGENT_ID', {
  persona: 'CHOSEN_PERSONA',
  customPersona: 'CUSTOM_TEXT_OR_UNDEFINED',
  boundaries: {
    allowBash: BOOL,
    allowFileWrites: BOOL,
    allowWebSearch: BOOL,
    allowSystemFiles: BOOL
  },
  mcpConnections: ['memory'],
  allowedAgents: ['AGENT_NAME_1', 'AGENT_NAME_2']
});
console.log('Config updated!');
process.exit(0);
"
```

Replace placeholder values with the user's actual choices. For fields that weren't changed, keep the existing values from Step 2.

## Step 6: Confirm

Show the updated config summary. Remind the user to restart IronClaw for changes to take effect (config is cached for up to 60 seconds).
