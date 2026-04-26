---
name: switch-agent
description: Switch the active IronClaw agent for the current session
---

# /switch-agent — Switch Active Agent

Switch which agent handles messages in the current session.

## Step 1: List Available Agents

Run from the shared package directory to list all agents:

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

## Step 2: Select Agent

Use AskUserQuestion with the list of agents as options. Show each agent's name and persona.

## Step 3: Apply

For **CLI mode**: Tell the user to restart with the agent flag:
```bash
pnpm start -- --agent AGENT_NAME
```

For **full stack mode** (gateway + runtime): The agent name needs to be sent in the InboundMessage. The web app can be updated to include an agent selector. For now, tell the user which agent they selected and that it will be active on their next `pnpm start -- --agent AGENT_NAME`.

## Notes

- Each agent has its own memory namespace — switching agents means different conversation history and memories
- The default agent is always available as a fallback
- Use `/add-agent` to create new agents, `/configure` to modify existing ones
