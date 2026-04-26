/**
 * Hook implementations for the Claude Agent SDK integration.
 *
 * - createAuditHook: PostToolUse hook that logs tool executions to the database
 * - createApprovalHook: PreToolUse hook that checks tool approval requirements
 */
import path from "node:path";
import type { HookCallbackMatcher, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { toolExecutionRepo } from "@ironclaw/shared";

// ---------------------------------------------------------------------------
// Audit hook (PostToolUse) — logs every tool execution to the database
// ---------------------------------------------------------------------------

const MAX_AUDIT_INPUT_SIZE = 10_000;

export function createAuditHook(sessionId: string): HookCallbackMatcher {
  return {
    hooks: [
      async (input: HookInput) => {
        if (input.hook_event_name !== "PostToolUse") {
          return { continue: true };
        }

        const hookInput = input as HookInput & {
          tool_name: string;
          tool_input: unknown;
          tool_response: unknown;
          tool_use_id: string;
        };

        try {
          // Sanitize input — truncate large values
          const sanitizedInput: Record<string, unknown> = {};
          if (typeof hookInput.tool_input === "object" && hookInput.tool_input !== null) {
            for (const [key, value] of Object.entries(hookInput.tool_input as Record<string, unknown>)) {
              if (typeof value === "string" && value.length > MAX_AUDIT_INPUT_SIZE) {
                sanitizedInput[key] = value.slice(0, MAX_AUDIT_INPUT_SIZE) + `... [truncated, ${value.length} chars total]`;
              } else {
                sanitizedInput[key] = value;
              }
            }
          }

          // Truncate output
          let outputStr = "";
          if (typeof hookInput.tool_response === "string") {
            outputStr = hookInput.tool_response;
          } else if (hookInput.tool_response != null) {
            outputStr = JSON.stringify(hookInput.tool_response);
          }
          const truncatedOutput = outputStr.length > MAX_AUDIT_INPUT_SIZE
            ? outputStr.slice(0, MAX_AUDIT_INPUT_SIZE) + "... [truncated]"
            : outputStr;

          await toolExecutionRepo.logToolExecution({
            sessionId,
            toolName: hookInput.tool_name,
            permissionsUsed: [],
            input: sanitizedInput,
            output: { success: true, output: truncatedOutput },
            status: "executed",
            approvalRequired: false,
            durationMs: null,
          });
        } catch (err) {
          console.error("[audit] Failed to log tool execution:", err instanceof Error ? err.message : err);
        }

        return { continue: true };
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Approval hook (PreToolUse) — checks if the tool requires approval
// ---------------------------------------------------------------------------

/** Tools that require approval for untrusted sessions */
const UNTRUSTED_DENIED_TOOLS = new Set([
  "Bash", "Write", "Edit", "WebFetch", "WebSearch",
]);

/** Tools that require approval for trusted sessions */
const TRUSTED_DENIED_TOOLS = new Set([
  "Bash",
]);

// Bash can also access files but is handled by the allowBash boundary separately
const FILE_PATH_TOOLS = new Set(["Read", "Write", "Edit", "Glob", "Grep"]);

/** Check if a resolved path escapes the project directory */
function isSystemPath(toolInput: Record<string, unknown>, cwd: string): boolean {
  const pathArg = (toolInput.file_path ?? toolInput.path ?? "") as string;
  if (!pathArg) return false;
  const normalized = path.resolve(cwd, pathArg);
  return !normalized.startsWith(cwd + "/") && normalized !== cwd;
}

export interface ApprovalHookOptions {
  trustLevel: string;
  allowSystemFiles?: boolean;
  cwd?: string;
  /** Session the tool call belongs to — required for interactive approvals. */
  sessionId?: string;
  /** Surface approval lifecycle to the UI so the chat shows "waiting for approval". */
  onToolUse?: (
    toolName: string,
    status: "start" | "end" | "error" | "pending_approval" | "approval_resolved",
    durationMs?: number,
  ) => void;
}

/** How long to wait for a human decision before auto-denying. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export function createApprovalHook(options: ApprovalHookOptions): HookCallbackMatcher {
  const { trustLevel, allowSystemFiles = true, cwd = process.cwd(), sessionId, onToolUse } = options;
  return {
    hooks: [
      async (input: HookInput) => {
        if (input.hook_event_name !== "PreToolUse") {
          return { continue: true };
        }

        const hookInput = input as HookInput & {
          tool_name: string;
          tool_input: unknown;
          tool_use_id: string;
        };

        // Enforce allowSystemFiles boundary (applies to all trust levels)
        if (
          !allowSystemFiles &&
          FILE_PATH_TOOLS.has(hookInput.tool_name) &&
          typeof hookInput.tool_input === "object" &&
          hookInput.tool_input !== null &&
          isSystemPath(hookInput.tool_input as Record<string, unknown>, cwd)
        ) {
          return {
            continue: false,
            hookSpecificOutput: {
              hookEventName: "PreToolUse" as const,
              permissionDecision: "deny" as const,
              permissionDecisionReason: "File access outside the project directory is not allowed by agent boundaries",
            },
          };
        }

        // Operator trust level — allow everything else
        if (trustLevel === "operator") {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: "PreToolUse" as const,
              permissionDecision: "allow" as const,
            },
          };
        }

        // Check if the tool requires human approval at this trust level.
        const deniedTools = trustLevel === "trusted" ? TRUSTED_DENIED_TOOLS : UNTRUSTED_DENIED_TOOLS;
        if (deniedTools.has(hookInput.tool_name)) {
          // Defensive: without a sessionId we can't persist a pending row, fall back to auto-deny.
          if (!sessionId) {
            return {
              continue: false,
              hookSpecificOutput: {
                hookEventName: "PreToolUse" as const,
                permissionDecision: "deny" as const,
                permissionDecisionReason: `Tool "${hookInput.tool_name}" requires approval but no session is attached`,
              },
            };
          }

          try {
            const inputObj = (typeof hookInput.tool_input === "object" && hookInput.tool_input !== null)
              ? hookInput.tool_input as Record<string, unknown>
              : { value: hookInput.tool_input };
            const pending = await toolExecutionRepo.createPendingApproval({
              sessionId,
              toolName: hookInput.tool_name,
              input: inputObj,
            });
            console.log(`[approval] Pending ${pending.id} — ${hookInput.tool_name} (trust=${trustLevel})`);
            onToolUse?.(hookInput.tool_name, "pending_approval");

            const outcome = await toolExecutionRepo.waitForApprovalResolution(pending.id, APPROVAL_TIMEOUT_MS);
            console.log(`[approval] Resolved ${pending.id} → ${outcome}`);
            onToolUse?.(hookInput.tool_name, "approval_resolved");

            if (outcome === "approved") {
              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "allow" as const,
                },
              };
            }
            const reason = outcome === "timeout"
              ? `Approval timed out after ${Math.floor(APPROVAL_TIMEOUT_MS / 60000)} minutes`
              : `User denied tool "${hookInput.tool_name}"`;
            return {
              continue: false,
              hookSpecificOutput: {
                hookEventName: "PreToolUse" as const,
                permissionDecision: "deny" as const,
                permissionDecisionReason: reason,
              },
            };
          } catch (err) {
            console.error("[approval] Failed to create/poll approval:", err instanceof Error ? err.message : err);
            // On DB error, stay safe and deny rather than auto-allowing
            return {
              continue: false,
              hookSpecificOutput: {
                hookEventName: "PreToolUse" as const,
                permissionDecision: "deny" as const,
                permissionDecisionReason: `Approval system error: ${err instanceof Error ? err.message : "unknown"}`,
              },
            };
          }
        }

        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "allow" as const,
          },
        };
      },
    ],
  };
}
