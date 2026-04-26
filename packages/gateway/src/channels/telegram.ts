import { randomUUID, randomInt } from "node:crypto";
import { Bot } from "grammy";
import type { NatsConnection } from "nats";
import { StringCodec } from "nats";
import { NATS_SUBJECTS, agentRepo } from "@ironclaw/shared";
import type { InboundMessage, OutboundMessage } from "@ironclaw/shared";
import { resolveSessionKey } from "../router.js";

const sc = StringCodec();

/** Maximum allowed message content length */
const MAX_MESSAGE_LENGTH = 10_000;

/** Rate limit: max messages per sender within the window */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/** TTL for pending responses before cleanup (5 minutes) */
const PENDING_RESPONSE_TTL_MS = 5 * 60 * 1000;

// DM pairing: pending codes and approved senders
const pendingPairings = new Map<string, { senderId: string; senderName: string; expiresAt: number }>();
const approvedSenders = new Set<string>();

// Approved group chat IDs — groups must be explicitly approved by the operator
const approvedGroups = new Set<string>();

// Chat-to-agent mapping: chatId → { agentName, lastUsed }
// Volatile — resets on gateway restart. Chats silently revert to default agent.
const MAX_CHAT_AGENT_ENTRIES = 10_000;
const CHAT_AGENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const chatAgentMap = new Map<string, { name: string; lastUsed: number }>();

function setChatAgent(chatId: string, agentName: string): void {
  // Evict oldest entries if at capacity
  if (chatAgentMap.size >= MAX_CHAT_AGENT_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, val] of chatAgentMap) {
      if (val.lastUsed < oldestTime) {
        oldestTime = val.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) chatAgentMap.delete(oldestKey);
  }
  chatAgentMap.set(chatId, { name: agentName, lastUsed: Date.now() });
}

function getChatAgent(chatId: string): string | undefined {
  const entry = chatAgentMap.get(chatId);
  if (!entry) return undefined;
  if (Date.now() - entry.lastUsed > CHAT_AGENT_TTL_MS) {
    chatAgentMap.delete(chatId);
    return undefined;
  }
  entry.lastUsed = Date.now();
  return entry.name;
}

// Operator's Telegram user ID — messages from this user go to "main" session
let operatorId: string | null = null;

// Track pending responses by inbound message ID → Telegram chat ID + timestamp
const pendingResponses = new Map<string, { chatId: number; createdAt: number; buffer?: string }>();

// Per-sender rate limiting: senderId → timestamps of recent messages
const senderTimestamps = new Map<string, number[]>();

export interface TelegramConfig {
  botToken: string;
  operatorTelegramId?: string;
  webhookUrl?: string; // if set, use webhooks; otherwise long polling
  approvedSenderIds?: string[];
  approvedGroupIds?: string[];
}

function isRateLimited(senderId: string): boolean {
  const now = Date.now();
  const timestamps = senderTimestamps.get(senderId) ?? [];
  // Remove timestamps outside the window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  senderTimestamps.set(senderId, recent);

  if (recent.length >= RATE_LIMIT_MAX) {
    return true;
  }
  recent.push(now);
  return false;
}

export async function startTelegram(nc: NatsConnection, config: TelegramConfig): Promise<Bot> {
  const bot = new Bot(config.botToken);
  operatorId = config.operatorTelegramId ?? null;

  // Pre-approve configured senders
  if (config.approvedSenderIds) {
    for (const id of config.approvedSenderIds) {
      approvedSenders.add(id);
    }
  }
  // Operator is always approved
  if (operatorId) {
    approvedSenders.add(operatorId);
  }
  // Pre-approve configured groups
  if (config.approvedGroupIds) {
    for (const id of config.approvedGroupIds) {
      approvedGroups.add(id);
    }
  }

  // Handle /start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hello! I'm IronClaw, a personal AI assistant.\n\n" +
      "If you're the operator, your messages are connected to the main session.\n" +
      "If you're a new contact, you'll need a pairing code from the operator.",
    );
  });

  // Handle /pair command for DM pairing
  bot.command("pair", async (ctx) => {
    const senderId = String(ctx.from?.id ?? "");
    if (!senderId) return;

    if (approvedSenders.has(senderId)) {
      await ctx.reply("You're already paired!");
      return;
    }

    // Generate a 6-digit pairing code
    const code = String(randomInt(100000, 999999));
    pendingPairings.set(code, {
      senderId,
      senderName: ctx.from?.first_name ?? "Unknown",
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    await ctx.reply(
      `Your pairing code is: **${code}**\n\n` +
      "Send this code to the operator to get approved. The code expires in 10 minutes.",
      { parse_mode: "Markdown" },
    );
  });

  // Handle /approve <code> command (operator only)
  bot.command("approve", async (ctx) => {
    const senderId = String(ctx.from?.id ?? "");
    if (senderId !== operatorId) {
      await ctx.reply("Only the operator can approve pairings.");
      return;
    }

    const code = ctx.match?.trim();
    if (!code) {
      await ctx.reply("Usage: /approve <pairing-code>");
      return;
    }

    const pairing = pendingPairings.get(code);
    if (!pairing) {
      await ctx.reply("Invalid or expired pairing code.");
      return;
    }

    if (pairing.expiresAt < Date.now()) {
      pendingPairings.delete(code);
      await ctx.reply("Pairing code has expired.");
      return;
    }

    approvedSenders.add(pairing.senderId);
    pendingPairings.delete(code);
    await ctx.reply(`Approved ${pairing.senderName} (ID: ${pairing.senderId}).`);
  });

  // Handle /approve-group command (operator only)
  bot.command("approve_group", async (ctx) => {
    const senderId = String(ctx.from?.id ?? "");
    if (senderId !== operatorId) {
      await ctx.reply("Only the operator can approve groups.");
      return;
    }

    const chatId = String(ctx.chat.id);
    if (ctx.chat.id >= 0) {
      await ctx.reply("This command only works in group chats.");
      return;
    }

    approvedGroups.add(chatId);
    await ctx.reply(`Group approved (ID: ${chatId}). I'll now respond to messages here.`);
  });

  // Handle /agent command — switch which agent handles this chat
  bot.command("agent", async (ctx) => {
    const senderId = String(ctx.from?.id ?? "");
    // Only operator or approved senders can switch agents
    if (senderId !== operatorId && !approvedSenders.has(senderId)) {
      await ctx.reply("You must be paired to switch agents.");
      return;
    }

    const agentName = ctx.match?.trim();
    const chatIdStr = String(ctx.chat.id);

    if (!agentName) {
      const current = getChatAgent(chatIdStr) ?? "default";
      await ctx.reply(
        `Current agent: *${current}*\n\nUsage: /agent <name> — switch to a different agent\nExample: /agent research-bot\nUse /agent default to switch back.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Validate name format before any DB lookup or Markdown reply
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(agentName)) {
      await ctx.reply("Invalid agent name. Use only letters, numbers, hyphens, and underscores (max 64 chars).");
      return;
    }

    if (agentName === "default") {
      chatAgentMap.delete(chatIdStr); // direct delete for explicit reset
      await ctx.reply("Switched to the *default* agent.", { parse_mode: "Markdown" });
    } else {
      // Validate agent exists
      try {
        const tenant = await agentRepo.findOrCreateDefaultTenant();
        const agent = await agentRepo.getAgentByName(tenant.id, agentName);
        if (!agent) {
          const allAgents = await agentRepo.listAgents(tenant.id);
          const names = allAgents.map((a) => a.name).join(", ");
          await ctx.reply(`Agent "${agentName}" not found.\n\nAvailable agents: ${names}`);
          return;
        }
      } catch (err) {
        console.error("[telegram] Failed to validate agent:", err);
        await ctx.reply("Failed to validate agent name. Please try again.");
        return;
      }
      setChatAgent(chatIdStr, agentName);
      await ctx.reply(`Switched to agent *${agentName}*. All messages in this chat will now be handled by this agent.`, { parse_mode: "Markdown" });
    }
  });

  // Handle all text messages
  bot.on("message:text", async (ctx) => {
    const senderId = String(ctx.from?.id ?? "");
    const chatId = ctx.chat.id;
    const chatIdStr = String(chatId);
    const isGroup = chatId < 0;

    // Access control: groups must be explicitly approved
    if (isGroup && !approvedGroups.has(chatIdStr)) {
      // Silently ignore messages from unapproved groups
      // (don't reply — avoids spam in random groups that add the bot)
      return;
    }

    // Access control: DM senders must be paired
    if (!isGroup && !approvedSenders.has(senderId)) {
      await ctx.reply(
        "You're not paired with this bot yet. Send /pair to get a pairing code, " +
        "then ask the operator to approve it with /approve <code>.",
      );
      return;
    }

    // Rate limiting
    if (isRateLimited(senderId)) {
      await ctx.reply("You're sending messages too fast. Please wait a moment.");
      return;
    }

    // Input length validation
    const content = ctx.message.text;
    if (content.length > MAX_MESSAGE_LENGTH) {
      await ctx.reply(`Message too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }

    const sessionKey = resolveSessionKey(
      "telegram",
      senderId,
      chatIdStr,
      operatorId ?? undefined,
    );

    // Resolve agent for this chat (if set via /agent command)
    const agentName = getChatAgent(chatIdStr);

    const inbound: InboundMessage = {
      id: randomUUID(),
      sessionKey,
      channel: "telegram",
      senderId,
      content,
      ...(agentName ? { agentName } : {}),
      metadata: {
        chatId,
        senderName: ctx.from?.first_name,
        isGroup,
      },
    };

    // Track this message so we can route the response back
    pendingResponses.set(inbound.id, { chatId, createdAt: Date.now() });

    nc.publish(NATS_SUBJECTS.INBOUND, sc.encode(JSON.stringify(inbound)));
  });

  // Listen for outbound messages and send to Telegram
  const outboundSub = nc.subscribe(NATS_SUBJECTS.OUTBOUND);
  void (async () => {
    for await (const msg of outboundSub) {
      try {
        const outbound: OutboundMessage = JSON.parse(sc.decode(msg.data));

        // Only handle messages for telegram sessions
        const pending = pendingResponses.get(outbound.id);
        if (!pending) continue;

        if (!outbound.done) {
          // Accumulate streaming chunks — don't send partial messages to Telegram
          pending.buffer = (pending.buffer ?? "") + outbound.content;
          continue;
        }

        // Done — send the accumulated response (or full content if no streaming)
        const fullContent = outbound.content || pending.buffer || "";
        if (fullContent) {
          const chunks = splitMessage(fullContent, 4000);
          for (const chunk of chunks) {
            await bot.api.sendMessage(pending.chatId, chunk);
          }
        }

        pendingResponses.delete(outbound.id);
      } catch (err) {
        console.error("[telegram] Failed to send outbound message:", err);
      }
    }
  })();

  // Start the bot
  if (config.webhookUrl) {
    console.log(`[telegram] Starting with webhook: ${config.webhookUrl}`);
    await bot.api.setWebhook(config.webhookUrl);
    console.log("[telegram] Webhook set successfully");
  } else {
    console.log("[telegram] Starting with long polling...");
    bot.start({
      onStart: () => console.log("[telegram] Bot started (polling)"),
    });
  }

  return bot;
}

/** Split a message into chunks that fit Telegram's character limit */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline or space
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen * 0.5) {
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/** Clean up expired pairing codes */
export function cleanupExpiredPairings(): void {
  const now = Date.now();
  for (const [code, pairing] of pendingPairings) {
    if (pairing.expiresAt < now) {
      pendingPairings.delete(code);
    }
  }
}

/** Clean up stale pending responses that never got a reply */
export function cleanupStalePendingResponses(): void {
  const now = Date.now();
  for (const [id, pending] of pendingResponses) {
    if (now - pending.createdAt > PENDING_RESPONSE_TTL_MS) {
      pendingResponses.delete(id);
    }
  }
}
