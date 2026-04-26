import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

/**
 * Model router — provides direct Anthropic API clients for background tasks
 * (compaction, auto-extraction). User-facing agent interactions use the
 * Claude Agent SDK (sdk-agent.ts), not this router.
 */

let mainClient: Anthropic | null = null;
let fastClient: Anthropic | null = null;

interface SimpleProvider {
  chat(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    options?: { systemPrompt?: string; maxTokens?: number },
  ): Promise<{ content: Anthropic.ContentBlock[] }>;
}

function createProvider(model: string): SimpleProvider {
  return {
    async chat(messages, options) {
      if (!mainClient) {
        mainClient = new Anthropic({ apiKey: config.anthropicApiKey });
      }
      const response = await mainClient.messages.create({
        model,
        max_tokens: options?.maxTokens ?? 4096,
        system: options?.systemPrompt ?? "",
        messages,
      });
      return { content: response.content };
    },
  };
}

export function getMainProvider(): SimpleProvider {
  return createProvider(config.anthropicModel);
}

export function getFastProvider(): SimpleProvider {
  const model = config.anthropicFastModel || config.anthropicModel;
  return createProvider(model);
}
