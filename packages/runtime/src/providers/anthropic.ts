/**
 * Minimal Anthropic API client for internal operations (compaction, fact extraction).
 * User-facing agent interactions use the Claude Agent SDK (sdk-agent.ts).
 * This client is only for background processing that doesn't need the full agent loop.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export type MessageContent = Anthropic.ContentBlock;
export type TextBlock = Anthropic.TextBlock;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

export async function llmCall(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options?: { systemPrompt?: string; maxTokens?: number },
): Promise<string> {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: options?.maxTokens ?? 4096,
    system: options?.systemPrompt ?? "",
    messages,
  });

  return response.content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Extract text from content blocks (for backward compat with compactor/auto-extract) */
export function extractText(content: MessageContent[]): string {
  return content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}
