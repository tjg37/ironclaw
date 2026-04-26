/**
 * Agent loop — thin wrapper around the SDK-based runAgent for backward compatibility.
 *
 * This preserves the original function signature so existing callers (tests, etc.)
 * continue to work. It handles message persistence (appendMessage before/after)
 * around the SDK call.
 */
import { messageRepo } from "@ironclaw/shared";
import { runAgent } from "./sdk-agent.js";
import { extractAndStoreFacts } from "./context/auto-extract.js";
import { compactSessionIfNeeded } from "./context/compactor.js";
import { config } from "./config.js";

export interface AgentLoopOptions {
  trustLevel?: string;
  agentId?: string;
  /** Callback for streaming text chunks */
  onText?: (text: string) => void;
  /** Callback for tool status events */
  onToolUse?: (toolName: string, status: "start" | "end" | "error" | "pending_approval" | "approval_resolved", durationMs?: number) => void;
}

export async function runAgentLoop(
  userMessage: string,
  sessionId: string,
  options?: AgentLoopOptions,
): Promise<string> {
  const trustLevel = options?.trustLevel ?? "operator";
  const agentId = options?.agentId;

  // Persist user message
  await messageRepo.appendMessage(sessionId, "user", userMessage);

  // Compact session if it's getting long
  if (agentId) {
    try {
      const compaction = await compactSessionIfNeeded(sessionId, agentId);
      if (compaction.compacted) {
        console.log(`[compactor] Compacted session, extracted ${compaction.factsExtracted} facts`);
      }
    } catch (err) {
      console.error("[compactor] Failed:", err instanceof Error ? err.message : err);
    }
  }

  // Run the SDK-based agent
  const finalText = await runAgent(userMessage, {
    agentId,
    trustLevel,
    sessionId,
    onText: options?.onText,
    onToolUse: options?.onToolUse,
  });

  // Persist final assistant response
  await messageRepo.appendMessage(sessionId, "assistant", finalText);

  // Auto-extract durable facts from this turn (non-blocking)
  if (agentId && config.voyageApiKey) {
    extractAndStoreFacts(userMessage, finalText, agentId, sessionId).catch((err) => {
      console.error("[auto-extract] Failed:", err instanceof Error ? err.message : err);
    });
  }

  return finalText;
}
