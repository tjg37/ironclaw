import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StringCodec } from "nats";
import type { NatsConnection } from "nats";
import { channelsRepo, NATS_SUBJECTS } from "@ironclaw/shared";
import type { InboundMessage } from "@ironclaw/shared";

const sc = StringCodec();

/** Maximum webhook body size (64KB) */
const MAX_BODY_SIZE = 64 * 1024;

interface WebhookConfig {
  source: string;
  secret: string;
  sessionKey?: string;
}

interface WebhookEntry {
  agentId: string;
  config: WebhookConfig;
}

export function createWebhookHandler(nc: NatsConnection, agentId: string) {
  // In-memory cache of webhook configs, keyed by source
  let webhooksBySource = new Map<string, WebhookEntry>();

  async function loadWebhooks(): Promise<void> {
    // Load all webhook channel connections for the given agent.
    // We iterate all connections and filter for webhooks with a source config.
    const connections = await channelsRepo.getChannelConnections(agentId);

    const map = new Map<string, WebhookEntry>();
    for (const row of connections) {
      if (row.channelType !== "webhook") continue;
      const config = row.config as WebhookConfig;
      if (config?.source) {
        map.set(config.source, {
          agentId: row.agentId!,
          config,
        });
      }
    }
    webhooksBySource = map;
    console.log(`[webhook] Loaded ${map.size} webhook config(s)`);
  }

  // Initial load
  void loadWebhooks();

  /** Reload webhook configs (called when configs change) */
  async function reload(): Promise<void> {
    await loadWebhooks();
  }

  /** Handle an incoming HTTP request for /webhook/:source */
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    source: string,
  ): Promise<void> {
    // Only accept POST
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Validate content-type
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      res.writeHead(415, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Content-Type must be application/json" }));
      return;
    }

    // Look up webhook config
    const entry = webhooksBySource.get(source);
    if (!entry) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unknown webhook source" }));
      return;
    }

    // Validate secret
    const providedSecret = req.headers["x-webhook-secret"] as string | undefined;
    if (providedSecret !== entry.config.secret) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing webhook secret" }));
      return;
    }

    // Read body with size limit
    try {
      const body = await readBody(req, MAX_BODY_SIZE);
      let payload: Record<string, unknown>;

      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Malformed JSON" }));
        return;
      }

      const sessionKey = entry.config.sessionKey ?? `webhook:${source}`;
      const content =
        typeof payload["content"] === "string"
          ? payload["content"]
          : JSON.stringify(payload);

      const inbound: InboundMessage = {
        id: randomUUID(),
        sessionKey,
        channel: "webhook",
        senderId: source,
        content,
        metadata: { webhookSource: source },
      };

      nc.publish(NATS_SUBJECTS.INBOUND, sc.encode(JSON.stringify(inbound)));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      const status = err instanceof BodyTooLargeError ? 413 : 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }

  return { handle, reload };
}

class BodyTooLargeError extends Error {
  constructor(maxSize: number) {
    super(`Body too large (max ${maxSize} bytes)`);
    this.name = "BodyTooLargeError";
  }
}

function readBody(req: IncomingMessage, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new BodyTooLargeError(maxSize));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", reject);
  });
}
