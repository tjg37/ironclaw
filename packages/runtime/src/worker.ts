import { connect, StringCodec } from "nats";
import type { NatsConnection, Subscription } from "nats";
import {
  agentRepo,
  sessionRepo,
  client,
  setVoyageApiKey,
  NATS_SUBJECTS,
  AGENT_NAME_REGEX,
} from "@ironclaw/shared";
import type { InboundMessage, OutboundMessage } from "@ironclaw/shared";
import { runAgentLoop } from "./agent-loop.js";
import { config } from "./config.js";

const NATS_URL = process.env["NATS_URL"] ?? "nats://localhost:4222";

/** Maximum allowed inbound message content length */
const MAX_INBOUND_LENGTH = 10_000;

const sc = StringCodec();
let nc: NatsConnection | null = null;
let inboundSub: Subscription | null = null;

// Populated by main() before message processing starts
let defaultTenantId = "";
let defaultAgentId = "";

// Cache agent name → ID lookups (60s TTL)
const AGENT_CACHE_TTL_MS = 60_000;
const agentNameCache = new Map<string, { id: string; fetchedAt: number }>();

async function resolveAgentId(agentName?: string): Promise<string> {
  if (!agentName || agentName === "default") {
    return defaultAgentId;
  }

  if (!AGENT_NAME_REGEX.test(agentName)) {
    console.warn(`[worker] Invalid agent name "${agentName.slice(0, 64)}", falling back to default`);
    return defaultAgentId;
  }

  // Check cache
  const cached = agentNameCache.get(agentName);
  if (cached && Date.now() - cached.fetchedAt < AGENT_CACHE_TTL_MS) {
    return cached.id;
  }

  const agent = await agentRepo.getAgentByName(defaultTenantId, agentName);
  if (agent) {
    agentNameCache.set(agentName, { id: agent.id, fetchedAt: Date.now() });
    return agent.id;
  }

  // Agent not found — evict any stale cache entry
  agentNameCache.delete(agentName);
  console.warn(`[worker] Agent "${agentName}" not found, falling back to default`);
  return defaultAgentId;
}

async function main(): Promise<void> {
  if (config.authMode === "api_key" && !config.anthropicApiKey) {
    console.error("[worker] Error: ANTHROPIC_API_KEY is required (or set AUTH_MODE=max_plan).");
    process.exit(1);
  }

  if (config.voyageApiKey) {
    setVoyageApiKey(config.voyageApiKey);
  }

  // Bootstrap default tenant and agent
  const tenant = await agentRepo.findOrCreateDefaultTenant();
  const agent = await agentRepo.findOrCreateDefaultAgent(tenant.id);
  defaultTenantId = tenant.id;
  defaultAgentId = agent.id;

  // List available agents
  const allAgents = await agentRepo.listAgents(tenant.id);
  console.log(`[worker] ${allAgents.length} agent(s) available: ${allAgents.map((a) => a.name).join(", ")}`);

  console.log(`[worker] Connecting to NATS at ${NATS_URL}...`);
  nc = await connect({ servers: NATS_URL });
  console.log("[worker] NATS connected");
  console.log(`[worker] Agent SDK mode enabled`);
  console.log(`[worker] Memory: ${config.voyageApiKey ? "enabled" : "disabled"}`);
  console.log(`[worker] Web search: enabled (SDK built-in)`);
  console.log(`[worker] Streaming: enabled`);

  inboundSub = nc.subscribe(NATS_SUBJECTS.INBOUND);
  console.log(`[worker] Subscribed to ${NATS_SUBJECTS.INBOUND}`);

  for await (const msg of inboundSub) {
    void processMessage(msg);
  }
}

async function processMessage(
  msg: { data: Uint8Array },
): Promise<void> {
  let inbound: InboundMessage | null = null;
  try {
    inbound = JSON.parse(sc.decode(msg.data)) as InboundMessage;
    console.log(`[worker] Received message ${inbound.id} on session "${inbound.sessionKey}"${inbound.agentName ? ` for agent "${inbound.agentName}"` : ""}`);

    // Validate inbound message length
    if (inbound.content.length > MAX_INBOUND_LENGTH) {
      console.warn(`[worker] Message ${inbound.id} too long (${inbound.content.length} chars), truncating`);
      inbound.content = inbound.content.slice(0, MAX_INBOUND_LENGTH);
    }

    // Resolve which agent handles this message
    const agentId = await resolveAgentId(inbound.agentName);

    // Resolve or create session (scoped to the resolved agent)
    const session = await sessionRepo.findOrCreateSession(agentId, inbound.sessionKey);
    await sessionRepo.updateSessionTimestamp(session.id);

    // Determine trust level:
    // 1. Only internal origins (cli, cron) may set trust via metadata
    // 2. CLI + webchat are authenticated upstream, so any session is operator — this
    //    lets users split conversations across multiple sessionKeys without losing trust.
    // 3. Telegram and anything else is untrusted so the approval queue gates restricted tools.
    const INTERNAL_CHANNELS = new Set(["cli", "cron"]);
    const AUTHENTICATED_CHANNELS = new Set(["cli", "webchat"]);
    const metaTrust = (inbound.metadata as Record<string, unknown> | undefined)?.trustLevel;
    let trustLevel: string;
    if (
      typeof metaTrust === "string" &&
      ["operator", "trusted", "untrusted"].includes(metaTrust) &&
      INTERNAL_CHANNELS.has(inbound.channel)
    ) {
      trustLevel = metaTrust;
    } else if (AUTHENTICATED_CHANNELS.has(inbound.channel)) {
      trustLevel = "operator";
    } else {
      trustLevel = "untrusted";
    }
    // Dev override: force webchat to a lower trust level so the approval queue can be exercised
    // without reconfiguring sessions. Valid values: "trusted" or "untrusted". Operator mode
    // cannot be granted via this var to prevent escalation.
    const webTrustOverride = process.env["WEB_TRUST_LEVEL_OVERRIDE"];
    if (
      inbound.channel === "webchat" &&
      (webTrustOverride === "trusted" || webTrustOverride === "untrusted")
    ) {
      trustLevel = webTrustOverride;
    }

    // Publish streaming text chunks as they arrive
    const publishChunk = (content: string, done: boolean) => {
      if (!nc || !inbound) return;
      const outbound: OutboundMessage = {
        id: inbound.id,
        sessionKey: inbound.sessionKey,
        content,
        done,
      };
      nc.publish(NATS_SUBJECTS.OUTBOUND, sc.encode(JSON.stringify(outbound)));
    };

    // Publish tool status events so web clients can show activity
    const publishToolStatus = (toolName: string, status: string) => {
      if (!nc || !inbound) return;
      const outbound: OutboundMessage = {
        id: inbound.id,
        sessionKey: inbound.sessionKey,
        content: "",
        done: false,
        metadata: { toolName, toolStatus: status },
      };
      nc.publish(NATS_SUBJECTS.OUTBOUND, sc.encode(JSON.stringify(outbound)));
    };

    // Run agent loop (handles message persistence, compaction, auto-extraction)
    await runAgentLoop(inbound.content, session.id, {
      trustLevel,
      agentId,
      onText: (text) => publishChunk(text, false),
      onToolUse: (toolName, status) => publishToolStatus(toolName, status),
    });

    // Send done signal (empty content — chunks already delivered the text)
    publishChunk("", true);
    console.log(`[worker] Responded to message ${inbound.id}`);
  } catch (err) {
    console.error("[worker] Error processing message:", err);

    if (inbound && nc) {
      const errorOutbound: OutboundMessage = {
        id: inbound.id,
        sessionKey: inbound.sessionKey,
        content: "Sorry, I encountered an error processing your message. Please try again.",
        done: true,
      };
      nc.publish(NATS_SUBJECTS.OUTBOUND, sc.encode(JSON.stringify(errorOutbound)));
    }
  }
}

async function shutdown(): Promise<void> {
  console.log("[worker] Shutting down...");
  inboundSub?.unsubscribe();
  if (nc) {
    await nc.drain();
    nc = null;
  }
  await client.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

main().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});
