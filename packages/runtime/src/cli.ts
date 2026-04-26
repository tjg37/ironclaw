import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { agentRepo, sessionRepo, messageRepo, client, setVoyageApiKey } from "@ironclaw/shared";
import { db } from "@ironclaw/shared";
import { sql } from "drizzle-orm";
import { runAgentLoop } from "./agent-loop.js";
import { config } from "./config.js";
import { renderMarkdown } from "./format.js";

// ANSI colors
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
const red = (s: string) => `\x1b[31m${s}\x1b[39m`;

// Spinner — animates continuously until text starts streaming.
// Label updates to show tool activity (e.g., "⚡ memory_search") while spinning.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerLabel = "Thinking";

function startSpinner(label = "Thinking"): void {
  stopSpinner();
  spinnerLabel = label;
  let i = 0;
  spinnerInterval = setInterval(() => {
    process.stdout.write(`\r\x1b[K${dim(`${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${spinnerLabel}...`)}`);
  }, 80);
}

function setSpinnerLabel(label: string): void {
  spinnerLabel = label;
}

function stopSpinner(): void {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    process.stdout.write("\r\x1b[K");
  }
}

async function checkDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

function printCapabilities(): void {
  const capabilities: Array<[string, boolean, string]> = [
    ["Memory", !!config.voyageApiKey, "set VOYAGE_API_KEY in .env"],
    ["Web search", true, ""],  // Built into Claude Agent SDK
  ];

  for (const [name, enabled, hint] of capabilities) {
    if (enabled) {
      console.log(`  ${name}: ${green("enabled")}`);
    } else {
      console.log(`  ${name}: ${yellow("disabled")} ${dim(`(${hint})`)}`);
    }
  }
}

async function printRecentHistory(sessionId: string): Promise<void> {
  try {
    const allMessages = await messageRepo.getSessionMessages(sessionId);
    // Show last 6 messages (3 turns)
    const recent = allMessages.slice(-6);
    if (recent.length === 0) return;

    console.log(dim("─".repeat(50)));
    console.log(dim("Recent conversation:"));
    for (const msg of recent) {
      const prefix = msg.role === "user" ? "you" : "assistant";
      const content = msg.content.length > 200
        ? msg.content.slice(0, 200) + "..."
        : msg.content;
      if (msg.role === "user") {
        console.log(`  ${cyan(prefix + ">")} ${content}`);
      } else {
        console.log(`  ${dim(prefix + ">")} ${content}`);
      }
    }
    console.log(dim("─".repeat(50)));
    console.log();
  } catch (err) {
    // Non-fatal — log for debugging but don't block startup
    console.error(dim(`[debug] Failed to load history: ${err instanceof Error ? err.message : String(err)}`));
  }
}

async function main() {
  if (config.authMode === "api_key" && !config.anthropicApiKey) {
    console.error(red("Error: ANTHROPIC_API_KEY environment variable is required."));
    console.error(`Set it in .env, or use ${cyan("AUTH_MODE=max_plan")} to use Claude Code Max credits.`);
    process.exit(1);
  }

  // Pre-flight: check database connectivity
  const dbOk = await checkDatabase();
  if (!dbOk) {
    console.error(red("Error: Cannot connect to PostgreSQL (port 5433)."));
    console.error();
    console.error("Start the database with one of:");
    console.error(`  ${cyan("docker compose -f docker-compose.dev.yml up -d")}`);
    console.error(`  or use ${cyan("/start")} in Claude Code`);
    process.exit(1);
  }

  // Initialize Voyage API key from config so embeddings module doesn't read env directly
  if (config.voyageApiKey) {
    setVoyageApiKey(config.voyageApiKey);
  }

  const tenant = await agentRepo.findOrCreateDefaultTenant();

  // Resolve agent: --agent flag or default
  const agentFlagIdx = process.argv.indexOf("--agent");
  const agentFlagValue = process.argv.find((a) => a.startsWith("--agent="))?.split("=")[1]
    ?? (agentFlagIdx !== -1 ? process.argv[agentFlagIdx + 1] : undefined);

  if (agentFlagIdx !== -1 && (!agentFlagValue || agentFlagValue.startsWith("-"))) {
    console.error(red("Error: --agent requires a value (e.g., --agent research-assistant)"));
    process.exit(1);
  }
  const agentFlag = agentFlagValue;

  let agent;
  if (agentFlag) {
    const found = await agentRepo.getAgentByName(tenant.id, agentFlag);
    if (!found) {
      const allAgents = await agentRepo.listAgents(tenant.id);
      console.error(red(`Error: Agent "${agentFlag}" not found.`));
      console.error(`Available agents: ${allAgents.map((a) => a.name).join(", ")}`);
      process.exit(1);
    }
    agent = found;
  } else {
    agent = await agentRepo.findOrCreateDefaultAgent(tenant.id);
  }

  const agentConfig = (agent.config ?? {}) as Record<string, unknown>;
  const session = await sessionRepo.findOrCreateSession(agent.id, "main");

  const rl = readline.createInterface({ input, output });

  console.log(`\n${cyan("IronClaw CLI")} ${dim("(Agent SDK mode)")}`);
  console.log(`Agent: ${cyan(agent.name)}${agent.name === "default" ? "" : dim(` (${agentConfig.persona ?? "general"})`)}`);
  console.log(`Session: ${dim(session.id)}`);
  console.log(`Model: ${dim((agentConfig.model as string) ?? config.anthropicModel)}`);
  printCapabilities();
  console.log();

  // Show recent conversation history if resuming a session
  await printRecentHistory(session.id);

  console.log(`Type your message and press Enter. Type "exit" or Ctrl+C to quit.\n`);

  rl.on("close", async () => {
    console.log("\nGoodbye!");
    await client.end();
    process.exit(0);
  });

  while (true) {
    let userInput: string;
    try {
      userInput = await rl.question("you> ");
    } catch {
      break;
    }

    const trimmed = userInput.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit" || trimmed === "/exit" || trimmed === "/quit") {
      console.log("Goodbye!");
      await client.end();
      process.exit(0);
    }

    // Streaming state
    let headerPrinted = false;

    startSpinner("Thinking");

    try {
      await sessionRepo.updateSessionTimestamp(session.id);

      const response = await runAgentLoop(trimmed, session.id, {
        trustLevel: "operator",
        agentId: agent.id,
        onText: (text) => {
          stopSpinner();
          if (!headerPrinted) {
            process.stdout.write("\nassistant> ");
            headerPrinted = true;
          }
          process.stdout.write(text);
        },
        onToolUse: (toolName, status) => {
          if (headerPrinted) return; // Already streaming text — ignore tool status
          if (status === "start") {
            setSpinnerLabel(`⚡ ${toolName}`);
          } else if (status === "end" || status === "error") {
            setSpinnerLabel("Thinking");
          }
        },
      });

      stopSpinner();

      if (headerPrinted) {
        // Streaming was used — just add trailing newlines
        process.stdout.write("\n\n");
      } else {
        // No streaming events — fall back to rendering the full response
        console.log(`\nassistant> ${renderMarkdown(response)}\n`);
      }
    } catch (err: unknown) {
      stopSpinner();
      const error = err as { status?: number; error?: { error?: { message?: string } } };
      if (error.status === 400 && error.error?.error?.message?.includes("credit balance")) {
        console.error(`\n${red("Error: Your Anthropic credit balance is too low.")}`);
        console.error("Add credits at: https://console.anthropic.com/settings/billing\n");
      } else if (error.status === 401) {
        console.error(`\n${red("Error: Invalid Anthropic API key.")} Check your ANTHROPIC_API_KEY in .env\n`);
      } else {
        const message = error.error?.error?.message ?? (err instanceof Error ? err.message : String(err));
        console.error(`\n${red(`Error: ${message}`)}\n`);
      }
    }
  }

  await client.end();
}

main();
