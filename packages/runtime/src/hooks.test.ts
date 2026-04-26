import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApprovalHook, createAuditHook } from "./hooks.js";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";

// Mock the tool execution repo for hook tests.
vi.mock("@ironclaw/shared", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ironclaw/shared");
  return {
    ...actual,
    toolExecutionRepo: {
      logToolExecution: vi.fn().mockResolvedValue(undefined),
      createPendingApproval: vi.fn().mockResolvedValue({ id: "pending-1" }),
      waitForApprovalResolution: vi.fn().mockResolvedValue("denied"),
      resolveApproval: vi.fn(),
      listPendingApprovals: vi.fn().mockResolvedValue([]),
      getSessionToolExecutions: vi.fn().mockResolvedValue([]),
    },
  };
});

const { toolExecutionRepo } = await import("@ironclaw/shared");
const mockLogToolExecution = (toolExecutionRepo as unknown as { logToolExecution: ReturnType<typeof vi.fn> }).logToolExecution;
const mockCreatePending = (toolExecutionRepo as unknown as { createPendingApproval: ReturnType<typeof vi.fn> }).createPendingApproval;
const mockWait = (toolExecutionRepo as unknown as { waitForApprovalResolution: ReturnType<typeof vi.fn> }).waitForApprovalResolution;

/** Helper to create a PreToolUse hook input with required base fields */
function makePreToolUseInput(toolName: string, toolInput: Record<string, unknown> = {}): HookInput {
  return {
    session_id: "test-session",
    transcript_path: "/tmp/test-transcript",
    cwd: "/tmp/test-cwd",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "test-id",
  } as HookInput;
}

/** Call a hook function with all required arguments */
function callHook(fn: (typeof createApprovalHook extends (...args: never[]) => { hooks: (infer H)[] } ? H : never), input: HookInput) {
  return (fn as (input: HookInput, toolUseId: string | undefined, options: Record<string, unknown>) => Promise<unknown>)(input, "test-id", {});
}

describe("createApprovalHook", () => {
  beforeEach(() => {
    mockCreatePending.mockClear();
    mockWait.mockClear();
    // default: restricted tools end up denied so we don't have to set per-test
    mockWait.mockResolvedValue("denied");
  });

  describe("operator trust level", () => {
    it("allows all tools", async () => {
      const hook = createApprovalHook({ trustLevel: "operator" });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput("Bash"));
      expect(result).toEqual({
        continue: true,
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
      });
    });

    it("denies file access outside project when allowSystemFiles is false", async () => {
      const hook = createApprovalHook({
        trustLevel: "operator",
        allowSystemFiles: false,
        cwd: "/Users/test/project",
      });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput("Read", { file_path: "/etc/passwd" }));
      expect(result).toMatchObject({
        continue: false,
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    });

    it("allows file access within project when allowSystemFiles is false", async () => {
      const hook = createApprovalHook({
        trustLevel: "operator",
        allowSystemFiles: false,
        cwd: "/Users/test/project",
      });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput("Read", { file_path: "/Users/test/project/src/index.ts" }));
      expect(result).toMatchObject({
        continue: true,
        hookSpecificOutput: { permissionDecision: "allow" },
      });
    });
  });

  describe("untrusted trust level", () => {
    it("creates a pending approval for Bash and waits", async () => {
      mockWait.mockResolvedValueOnce("denied");
      const hook = createApprovalHook({ trustLevel: "untrusted", sessionId: "sess-1" });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput("Bash", { command: "ls" }));
      expect(mockCreatePending).toHaveBeenCalledWith({
        sessionId: "sess-1",
        toolName: "Bash",
        input: { command: "ls" },
      });
      expect(mockWait).toHaveBeenCalled();
      expect(result).toMatchObject({
        continue: false,
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    });

    it("approved resolution allows the tool to proceed", async () => {
      mockWait.mockResolvedValueOnce("approved");
      const hook = createApprovalHook({ trustLevel: "untrusted", sessionId: "sess-1" });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput("Bash"));
      expect(result).toMatchObject({
        continue: true,
        hookSpecificOutput: { permissionDecision: "allow" },
      });
    });

    it("timeout resolution denies with a timeout reason", async () => {
      mockWait.mockResolvedValueOnce("timeout");
      const hook = createApprovalHook({ trustLevel: "untrusted", sessionId: "sess-1" });
      const fn = hook.hooks[0]!;
      const result = (await callHook(fn, makePreToolUseInput("Bash"))) as {
        continue: boolean;
        hookSpecificOutput?: { permissionDecisionReason?: string };
      };
      expect(result.continue).toBe(false);
      expect(result.hookSpecificOutput?.permissionDecisionReason).toMatch(/timed out/i);
    });

    it.each(["Bash", "Write", "Edit", "WebSearch", "WebFetch"])("gates %s via approval", async (tool) => {
      mockWait.mockResolvedValueOnce("approved");
      const hook = createApprovalHook({ trustLevel: "untrusted", sessionId: "sess-1" });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput(tool));
      expect(mockCreatePending).toHaveBeenCalled();
      expect(result).toMatchObject({ continue: true });
    });

    it("skips approval and allows Read/Glob/Grep", async () => {
      const hook = createApprovalHook({ trustLevel: "untrusted", sessionId: "sess-1" });
      const fn = hook.hooks[0]!;
      for (const tool of ["Read", "Glob", "Grep"]) {
        const input = tool === "Read" ? makePreToolUseInput(tool, { file_path: "/x.ts" }) : makePreToolUseInput(tool);
        expect(await callHook(fn, input)).toMatchObject({ continue: true });
      }
      expect(mockCreatePending).not.toHaveBeenCalled();
    });

    it("falls back to immediate deny when sessionId is missing (defensive)", async () => {
      const hook = createApprovalHook({ trustLevel: "untrusted" });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput("Bash"));
      expect(mockCreatePending).not.toHaveBeenCalled();
      expect(result).toMatchObject({ continue: false });
    });

    it("denies when the approval subsystem throws (stay safe, do not open)", async () => {
      mockCreatePending.mockRejectedValueOnce(new Error("DB down"));
      const hook = createApprovalHook({ trustLevel: "untrusted", sessionId: "sess-1" });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput("Bash"));
      expect(result).toMatchObject({ continue: false });
    });
  });

  describe("trusted trust level", () => {
    it("gates Bash via approval and allows on approval", async () => {
      mockWait.mockResolvedValueOnce("approved");
      const hook = createApprovalHook({ trustLevel: "trusted", sessionId: "sess-1" });
      const fn = hook.hooks[0]!;
      const result = await callHook(fn, makePreToolUseInput("Bash"));
      expect(mockCreatePending).toHaveBeenCalled();
      expect(result).toMatchObject({ continue: true });
    });

    it("allows Write/Edit/WebSearch/WebFetch without approval", async () => {
      const hook = createApprovalHook({ trustLevel: "trusted", sessionId: "sess-1" });
      const fn = hook.hooks[0]!;
      for (const tool of ["Write", "Edit", "WebSearch", "WebFetch"]) {
        expect(await callHook(fn, makePreToolUseInput(tool))).toMatchObject({ continue: true });
      }
      expect(mockCreatePending).not.toHaveBeenCalled();
    });
  });

  it("ignores non-PreToolUse events", async () => {
    const hook = createApprovalHook({ trustLevel: "untrusted" });
    const fn = hook.hooks[0]!;
    const result = await callHook(fn, {
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      hook_event_name: "PostToolUse",
    } as HookInput);
    expect(result).toEqual({ continue: true });
  });
});

/** Helper to create a PostToolUse hook input */
function makePostToolUseInput(overrides: Record<string, unknown> = {}): HookInput {
  return {
    session_id: "test-session",
    transcript_path: "/tmp/test-transcript",
    cwd: "/tmp/test-cwd",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "ls -la" },
    tool_response: "file1.ts\nfile2.ts",
    tool_use_id: "tool-use-123",
    ...overrides,
  } as HookInput;
}

describe("createAuditHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs tool execution for PostToolUse events", async () => {
    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    await callHook(fn, makePostToolUseInput());

    expect(mockLogToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-abc",
        toolName: "Bash",
        status: "executed",
        approvalRequired: false,
      }),
    );
  });

  it("sanitizes tool input in the log", async () => {
    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    await callHook(fn, makePostToolUseInput({
      tool_input: { command: "echo hello", file_path: "/src/index.ts" },
    }));

    expect(mockLogToolExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { command: "echo hello", file_path: "/src/index.ts" },
      }),
    );
  });

  it("truncates large input values", async () => {
    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    const largeValue = "x".repeat(15_000);
    await callHook(fn, makePostToolUseInput({
      tool_input: { content: largeValue },
    }));

    const call = mockLogToolExecution.mock.calls[0]![0] as { input: { content: string } };
    expect(call.input.content.length).toBeLessThan(largeValue.length);
    expect(call.input.content).toContain("[truncated");
  });

  it("truncates large output", async () => {
    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    const largeOutput = "y".repeat(15_000);
    await callHook(fn, makePostToolUseInput({
      tool_response: largeOutput,
    }));

    const call = mockLogToolExecution.mock.calls[0]![0] as { output: { output: string } };
    expect(call.output.output.length).toBeLessThan(largeOutput.length);
    expect(call.output.output).toContain("[truncated]");
  });

  it("handles object tool_response by JSON stringifying", async () => {
    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    await callHook(fn, makePostToolUseInput({
      tool_response: { result: "success", data: [1, 2, 3] },
    }));

    const call = mockLogToolExecution.mock.calls[0]![0] as { output: { output: string } };
    expect(call.output.output).toContain('"result":"success"');
  });

  it("handles null tool_response", async () => {
    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    await callHook(fn, makePostToolUseInput({
      tool_response: null,
    }));

    const call = mockLogToolExecution.mock.calls[0]![0] as { output: { output: string } };
    expect(call.output.output).toBe("");
  });

  it("ignores non-PostToolUse events", async () => {
    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    await callHook(fn, makePreToolUseInput("Bash"));

    expect(mockLogToolExecution).not.toHaveBeenCalled();
  });

  it("continues even if logging fails", async () => {
    mockLogToolExecution.mockRejectedValueOnce(new Error("DB down"));

    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    const result = await callHook(fn, makePostToolUseInput());

    expect(result).toEqual({ continue: true });
  });

  it("always returns continue: true", async () => {
    const hook = createAuditHook("session-abc");
    const fn = hook.hooks[0]!;
    const result = await callHook(fn, makePostToolUseInput());
    expect(result).toEqual({ continue: true });
  });
});
