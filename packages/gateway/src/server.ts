import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { connect, StringCodec } from "nats";
import type { NatsConnection, Subscription } from "nats";
import { NATS_SUBJECTS, agentRepo, sessionRepo, messageRepo, toolExecutionRepo, cronJobsRepo, validateAgentConfig } from "@ironclaw/shared";
import type { InboundMessage, OutboundMessage } from "@ironclaw/shared";
import { resolveSessionKey } from "./router.js";
import { startTelegram, cleanupExpiredPairings, cleanupStalePendingResponses } from "./channels/telegram.js";
import { startScheduler, stopScheduler, reloadJobs } from "./scheduler.js";
import { createWebhookHandler } from "./channels/webhook.js";

const GATEWAY_PORT = parseInt(process.env["GATEWAY_PORT"] ?? "18789", 10);
const NATS_URL = process.env["NATS_URL"] ?? "nats://localhost:4222";
const TELEGRAM_BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
const TELEGRAM_OPERATOR_ID = process.env["TELEGRAM_OPERATOR_ID"] ?? "";

// WebSocket authentication token — required for all WS connections
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const WS_AUTH_TOKEN = process.env["GATEWAY_WS_TOKEN"] ?? "";

/** Maximum allowed message content length (10KB) */
const MAX_MESSAGE_LENGTH = 10_000;

const sc = StringCodec();
let nc: NatsConnection | null = null;
let outboundSub: Subscription | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let webhookHandler: ReturnType<typeof createWebhookHandler> | null = null;
let cachedTenantId: string | null = null;

// Track WS clients by session key so we can route outbound messages
const clientsBySession = new Map<string, Set<WebSocket>>();

function addClient(sessionKey: string, ws: WebSocket): void {
  let set = clientsBySession.get(sessionKey);
  if (!set) {
    set = new Set();
    clientsBySession.set(sessionKey, set);
  }
  set.add(ws);
}

function removeClient(ws: WebSocket): void {
  for (const [key, set] of clientsBySession) {
    set.delete(ws);
    if (set.size === 0) clientsBySession.delete(key);
  }
}

async function startOutboundListener(): Promise<void> {
  if (!nc) return;
  outboundSub = nc.subscribe(NATS_SUBJECTS.OUTBOUND);
  for await (const msg of outboundSub) {
    try {
      const outbound: OutboundMessage = JSON.parse(sc.decode(msg.data));
      const clients = clientsBySession.get(outbound.sessionKey);
      if (clients) {
        const payload = JSON.stringify(outbound);
        for (const ws of clients) {
          if (ws.readyState === 1) {
            ws.send(payload);
          }
        }
      }
    } catch (err) {
      console.error("[gateway] Failed to process outbound message:", err);
    }
  }
}

import { buildCorsOrigins, getCorsHeaders as buildCorsHeaders } from "./cors.js";

// Allow multiple CORS origins: localhost (dev) + configured origin (remote access)
const CORS_ALLOWED_ORIGINS = buildCorsOrigins(process.env["CORS_ALLOWED_ORIGIN"]);

function getCorsHeaders(req?: { headers?: { origin?: string } }): Record<string, string> {
  return buildCorsHeaders(CORS_ALLOWED_ORIGINS, req);
}

const httpServer = createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      nats: nc ? "connected" : "disconnected",
      telegram: TELEGRAM_BOT_TOKEN ? "enabled" : "disabled",
    }));
    return;
  }

  // List available agents (requires same auth token as WebSocket)
  if (req.method === "GET" && req.url?.startsWith("/agents")) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (token !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    void (async () => {
      try {
        // Use cached tenant from startup (populated in main())
        const tenantId = cachedTenantId ?? (await agentRepo.findOrCreateDefaultTenant()).id;
        const allAgents = await agentRepo.listAgents(tenantId);
        const agentList = allAgents.map((a) => {
          const cfg = (a.config ?? {}) as Record<string, unknown>;
          return {
            name: a.name,
            persona: cfg.persona ?? "general",
            customPersona: cfg.customPersona ?? null,
            model: cfg.model ?? "default",
            boundaries: cfg.boundaries ?? {},
            allowedAgents: cfg.allowedAgents ?? [],
          };
        });
        res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify(agentList));
      } catch (err) {
        console.error("[gateway] Failed to list agents:", err);
        res.writeHead(500, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to list agents" }));
      }
    })();
    return;
  }

  // Update agent config: PUT /agents/:name
  if (req.method === "PUT" && req.url?.startsWith("/agents/")) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (token !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    // Read request body (with size limit to prevent DoS)
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > 1e6) {
        aborted = true;
        res.writeHead(413, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      void (async () => {
        try {
          const agentName = decodeURIComponent(req.url!.split("/agents/")[1]!.split("?")[0]!);
          const tenantId = cachedTenantId ?? (await agentRepo.findOrCreateDefaultTenant()).id;
          const agent = await agentRepo.getAgentByName(tenantId, agentName);
          if (!agent) {
            res.writeHead(404, { ...getCorsHeaders(req), "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Agent "${agentName}" not found` }));
            return;
          }

          const body = Buffer.concat(chunks).toString();
          const updates = JSON.parse(body) as Record<string, unknown>;
          // Merge with existing config (only update provided fields)
          // "__default__" sentinel removes the key (e.g., model: "__default__" resets to env default)
          const currentConfig = (agent.config ?? {}) as Record<string, unknown>;
          const newConfig = { ...currentConfig, ...updates };
          for (const [key, val] of Object.entries(newConfig)) {
            if (val === "__default__") delete newConfig[key];
          }
          validateAgentConfig(newConfig);
          await agentRepo.updateAgentConfig(agent.id, newConfig);

          res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[gateway] Failed to update agent:", msg);
          res.writeHead(400, { ...getCorsHeaders(req), "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
      })();
    });
    return;
  }

  // List sessions with message previews: GET /sessions
  if (req.method === "GET" && req.url?.startsWith("/sessions") && !req.url?.includes("/sessions/")) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (token !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    void (async () => {
      try {
        const tenantId = cachedTenantId ?? (await agentRepo.findOrCreateDefaultTenant()).id;
        const url = new URL(req.url!, `http://${req.headers.host ?? "localhost"}`);
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const rawType = url.searchParams.get("type");
        const sessionType = rawType === "cron" || rawType === "chat" ? rawType : undefined;
        const rawStatus = url.searchParams.get("status");
        const status = rawStatus === "success" || rawStatus === "error" || rawStatus === "incomplete" ? rawStatus : undefined;
        const agentName = url.searchParams.get("agent") || undefined;
        const search = url.searchParams.get("search") || undefined;
        const result = await sessionRepo.listSessions(tenantId, {
          limit,
          cursor,
          sessionType,
          status,
          agentName,
          search,
        });
        res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error("[gateway] Failed to list sessions:", err);
        res.writeHead(500, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to list sessions" }));
      }
    })();
    return;
  }

  // Get messages for a session: GET /sessions/:id/messages
  if (req.method === "GET" && req.url?.match(/^\/sessions\/[^/]+\/messages/)) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (token !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    void (async () => {
      try {
        const sessionId = req.url!.split("/sessions/")[1]!.split("/messages")[0]!.split("?")[0]!;
        const msgs = await messageRepo.getSessionMessages(sessionId);
        const formatted = msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));
        res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify(formatted));
      } catch (err) {
        console.error("[gateway] Failed to get session messages:", err);
        res.writeHead(500, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to get messages" }));
      }
    })();
    return;
  }

  // Get merged timeline (messages + tool executions) for a session: GET /sessions/:id/events
  if (req.method === "GET" && req.url?.match(/^\/sessions\/[^/]+\/events/)) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (token !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    void (async () => {
      try {
        const sessionId = req.url!.split("/sessions/")[1]!.split("/events")[0]!.split("?")[0]!;
        const [msgs, execs] = await Promise.all([
          messageRepo.getSessionMessages(sessionId),
          toolExecutionRepo.getSessionToolExecutions(sessionId),
        ]);
        const events = [
          ...msgs.map((m) => ({
            kind: "message" as const,
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
          ...execs.map((e) => ({
            kind: "tool_call" as const,
            id: e.id,
            toolName: e.toolName,
            status: e.status,
            input: e.input,
            output: e.output,
            durationMs: e.durationMs,
            createdAt: e.createdAt,
          })),
        ].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
        res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
      } catch (err) {
        console.error("[gateway] Failed to get session events:", err);
        res.writeHead(500, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to get events" }));
      }
    })();
    return;
  }

  // List pending approvals: GET /approvals
  if (req.method === "GET" && req.url?.startsWith("/approvals") && !req.url?.includes("/approvals/")) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      if (url.searchParams.get("token") !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    void (async () => {
      try {
        const rows = await toolExecutionRepo.listPendingApprovals();
        res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify(rows));
      } catch (err) {
        console.error("[gateway] Failed to list approvals:", err);
        res.writeHead(500, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to list approvals" }));
      }
    })();
    return;
  }

  // Approve/deny a pending tool call: POST /approvals/:id/approve|deny
  if (req.method === "POST" && req.url?.match(/^\/approvals\/[^/]+\/(approve|deny)/)) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      if (url.searchParams.get("token") !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    void (async () => {
      try {
        const parts = req.url!.split("/");
        const id = parts[2]!;
        const action = parts[3]!.split("?")[0];
        const approved = action === "approve";
        const updated = await toolExecutionRepo.resolveApproval(id, approved);
        if (!updated) {
          res.writeHead(404, { ...getCorsHeaders(req), "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Approval not found or already resolved" }));
          return;
        }
        res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify(updated));
      } catch (err) {
        console.error("[gateway] Failed to resolve approval:", err);
        res.writeHead(500, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to resolve approval" }));
      }
    })();
    return;
  }

  // List cron jobs: GET /crons
  if (req.method === "GET" && req.url?.startsWith("/crons") && !req.url?.includes("/crons/")) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      if (url.searchParams.get("token") !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    void (async () => {
      try {
        const jobs = await cronJobsRepo.listAllWithAgent();
        res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify(jobs));
      } catch (err) {
        console.error("[gateway] Failed to list crons:", err);
        res.writeHead(500, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to list crons" }));
      }
    })();
    return;
  }

  // Toggle cron job enabled/disabled: PATCH /crons/:id/status
  if (req.method === "PATCH" && req.url?.match(/^\/crons\/[^/]+\/status/)) {
    if (WS_AUTH_TOKEN) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      if (url.searchParams.get("token") !== WS_AUTH_TOKEN) {
        res.writeHead(401, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    void (async () => {
      try {
        const jobId = req.url!.split("/crons/")[1]!.split("/status")[0]!.split("?")[0]!;
        let body = "";
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body) as { enabled?: unknown };
        if (typeof parsed.enabled !== "boolean") {
          res.writeHead(400, { ...getCorsHeaders(req), "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Body must include `enabled: boolean`" }));
          return;
        }
        const updated = await cronJobsRepo.setEnabledById(jobId, parsed.enabled);
        if (!updated) {
          res.writeHead(404, { ...getCorsHeaders(req), "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Cron job not found" }));
          return;
        }
        // Apply live — stop/start the scheduler's in-memory tasks.
        await reloadJobs();
        res.writeHead(200, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify(updated));
      } catch (err) {
        console.error("[gateway] Failed to toggle cron:", err);
        res.writeHead(500, { ...getCorsHeaders(req), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to toggle cron" }));
      }
    })();
    return;
  }

  // Route webhook requests: POST /webhook/:source
  if (req.method === "POST" && req.url?.startsWith("/webhook/")) {
    const source = req.url.slice("/webhook/".length).split("?")[0];
    if (source && webhookHandler) {
      void webhookHandler.handle(req, res, source);
      return;
    }
    res.writeHead(503, { ...getCorsHeaders(req), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Webhook handler not available" }));
    return;
  }

  res.writeHead(404, getCorsHeaders(req));
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  // Authenticate WebSocket connections via token
  if (WS_AUTH_TOKEN) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("token");
    if (token !== WS_AUTH_TOKEN) {
      ws.close(4001, "Unauthorized: invalid or missing token");
      return;
    }
  } else {
    console.warn("[gateway] GATEWAY_WS_TOKEN not set — WebSocket connections are unauthenticated!");
  }

  // Each WS client gets a unique session (not operator "main" by default)
  const clientId = randomUUID();
  const sessionKey = resolveSessionKey("webchat", clientId);
  addClient(sessionKey, ws);

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(String(raw)) as { id?: string; content?: string; agentName?: string; sessionKey?: string };
      if (!data.content || typeof data.content !== "string") return;

      // Validate message length
      if (data.content.length > MAX_MESSAGE_LENGTH) {
        ws.send(JSON.stringify({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` }));
        return;
      }

      // Validate agentName format if provided
      const agentName = data.agentName && /^[a-zA-Z0-9_-]{1,64}$/.test(data.agentName)
        ? data.agentName
        : undefined;

      // Allow the client to pick a sessionKey so users can split conversations ("New chat").
      // Must match "main" or "chat:<segment>" so it can't collide with cron/agent/dm keys.
      const clientSessionKey = typeof data.sessionKey === "string" && /^(main|chat:[a-zA-Z0-9][a-zA-Z0-9-]{0,63})$/.test(data.sessionKey)
        ? data.sessionKey
        : undefined;
      const resolvedSessionKey = clientSessionKey ?? sessionKey;

      // Register the ws under the resolved sessionKey so outbound streaming can route
      // back to the right socket. No-op if already registered for this key.
      addClient(resolvedSessionKey, ws);

      // Use client-provided ID if available (allows matching responses to requests)
      const inbound: InboundMessage = {
        id: typeof data.id === "string" && data.id.length > 0 ? data.id : randomUUID(),
        sessionKey: resolvedSessionKey,
        channel: "webchat",
        senderId: clientId,
        content: data.content,
        ...(agentName ? { agentName } : {}),
      };

      if (nc) {
        nc.publish(NATS_SUBJECTS.INBOUND, sc.encode(JSON.stringify(inbound)));
      } else {
        ws.send(JSON.stringify({ error: "NATS not connected" }));
      }
    } catch (err) {
      console.warn("[gateway] Received malformed WebSocket message:", err);
    }
  });

  ws.on("close", () => {
    removeClient(ws);
  });
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[gateway] Shutting down...");
  stopScheduler();
  if (cleanupInterval) clearInterval(cleanupInterval);
  outboundSub?.unsubscribe();
  wss.close();
  httpServer.close();
  if (nc) {
    await nc.drain();
    nc = null;
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

async function main(): Promise<void> {
  console.log(`[gateway] Connecting to NATS at ${NATS_URL}...`);
  nc = await connect({ servers: NATS_URL });
  console.log("[gateway] NATS connected");

  // Start listening for outbound messages in background
  void startOutboundListener();

  // Start Telegram if configured
  if (TELEGRAM_BOT_TOKEN) {
    await startTelegram(nc!, {
      botToken: TELEGRAM_BOT_TOKEN,
      operatorTelegramId: TELEGRAM_OPERATOR_ID || undefined,
    });
    // Clean up expired pairing codes and stale pending responses every 5 minutes
    cleanupInterval = setInterval(() => {
      cleanupExpiredPairings();
      cleanupStalePendingResponses();
    }, 5 * 60 * 1000);
  } else {
    console.log("[gateway] Telegram: disabled (set TELEGRAM_BOT_TOKEN in .env)");
  }

  // Resolve agent for scoped handlers (cached for /agents endpoint)
  const tenant = await agentRepo.findOrCreateDefaultTenant();
  cachedTenantId = tenant.id;
  const agent = await agentRepo.findOrCreateDefaultAgent(tenant.id);

  // Start webhook handler
  webhookHandler = createWebhookHandler(nc!, agent.id);

  // Start cron scheduler
  await startScheduler(nc!, agent.id);

  httpServer.listen(GATEWAY_PORT, () => {
    console.log(`[gateway] Listening on port ${GATEWAY_PORT}`);
    console.log(`[gateway] WebSocket: ws://localhost:${GATEWAY_PORT}`);
    console.log(`[gateway] Health: http://localhost:${GATEWAY_PORT}/health`);
    if (!WS_AUTH_TOKEN) {
      console.warn("[gateway] WARNING: Set GATEWAY_WS_TOKEN in .env to secure WebSocket connections");
    }
  });
}

main().catch((err) => {
  console.error("[gateway] Fatal:", err);
  process.exit(1);
});
