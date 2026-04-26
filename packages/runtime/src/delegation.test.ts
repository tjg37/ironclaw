import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "@ironclaw/shared";
import type { DelegateOptions } from "./sdk-agent.js";

// Mock only the database repos — delegateToAgent needs agentRepo and sessionRepo
vi.mock("@ironclaw/shared", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ironclaw/shared");
  return {
    ...actual,
    agentRepo: {
      getAgentByName: vi.fn(),
      getAgentById: vi.fn(),
      listAgents: vi.fn(),
    },
    sessionRepo: {
      findOrCreateSession: vi.fn().mockResolvedValue({ id: "session-123" }),
    },
  };
});

const { delegateToAgent } = await import("./sdk-agent.js");
const { agentRepo, sessionRepo } = await import("@ironclaw/shared");

const mockAgentRepo = agentRepo as unknown as {
  getAgentByName: ReturnType<typeof vi.fn>;
  getAgentById: ReturnType<typeof vi.fn>;
  listAgents: ReturnType<typeof vi.fn>;
};
const mockSessionRepo = sessionRepo as unknown as {
  findOrCreateSession: ReturnType<typeof vi.fn>;
};

/** A fake runAgent that resolves instantly */
const fakeRunAgent = vi.fn().mockResolvedValue("mock response from target agent");

/** Helper to build delegation options with sensible defaults */
function makeOpts(overrides: Partial<DelegateOptions> = {}): DelegateOptions {
  return {
    agentId: "source-agent-id",
    agentName: "source-agent",
    agentConfig: {
      allowedAgents: ["target-agent"],
      boundaries: { allowBash: true, allowFileWrites: true, allowWebSearch: true },
    },
    getTenantId: async () => "tenant-1",
    targetName: "target-agent",
    message: "Hello target",
    mode: "ask",
    delegationContext: { depth: 0, callStack: [] },
    _runAgent: fakeRunAgent,
    ...overrides,
  };
}

function getResponseText(result: { content: Array<{ text: string }> }): string {
  return result.content[0]!.text;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeRunAgent.mockResolvedValue("mock response from target agent");
  mockAgentRepo.getAgentByName.mockResolvedValue({
    id: "target-agent-id",
    name: "target-agent",
    tenantId: "tenant-1",
    config: { boundaries: {} },
  });
  mockSessionRepo.findOrCreateSession.mockResolvedValue({ id: "session-123" });
});

describe("delegateToAgent", () => {
  describe("depth checking", () => {
    it("rejects delegation at max depth (3)", async () => {
      const result = await delegateToAgent(makeOpts({
        delegationContext: { depth: 3, callStack: ["a", "b", "c"] },
      }));
      expect(getResponseText(result)).toContain("Maximum delegation depth");
      expect(fakeRunAgent).not.toHaveBeenCalled();
    });

    it("allows delegation below max depth", async () => {
      const result = await delegateToAgent(makeOpts({
        delegationContext: { depth: 2, callStack: ["a", "b"] },
      }));
      expect(getResponseText(result)).toContain("Response from target-agent");
    });

    it("allows delegation at depth 0", async () => {
      const result = await delegateToAgent(makeOpts());
      expect(getResponseText(result)).toContain("Response from target-agent");
    });
  });

  describe("loop detection", () => {
    it("rejects when target is already in call stack", async () => {
      const result = await delegateToAgent(makeOpts({
        targetName: "agent-b",
        agentConfig: { allowedAgents: ["agent-b"] },
        delegationContext: { depth: 1, callStack: ["agent-a", "agent-b"] },
      }));
      expect(getResponseText(result)).toContain("Delegation loop detected");
      expect(getResponseText(result)).toContain("agent-b");
      expect(fakeRunAgent).not.toHaveBeenCalled();
    });

    it("rejects self-delegation via call stack", async () => {
      const result = await delegateToAgent(makeOpts({
        targetName: "source-agent",
        agentConfig: { allowedAgents: ["source-agent"] },
        delegationContext: { depth: 1, callStack: ["source-agent"] },
      }));
      expect(getResponseText(result)).toContain("Delegation loop detected");
    });

    it("allows delegation to agent not in call stack", async () => {
      const result = await delegateToAgent(makeOpts({
        delegationContext: { depth: 1, callStack: ["agent-a"] },
      }));
      expect(getResponseText(result)).toContain("Response from target-agent");
    });

    it("shows the full call chain in loop error", async () => {
      const result = await delegateToAgent(makeOpts({
        targetName: "agent-a",
        agentConfig: { allowedAgents: ["agent-a"] },
        delegationContext: { depth: 2, callStack: ["agent-a", "agent-b"] },
      }));
      expect(getResponseText(result)).toContain("agent-a → agent-b → agent-a");
    });
  });

  describe("allowlist validation", () => {
    it("rejects when target is not in allowedAgents", async () => {
      const result = await delegateToAgent(makeOpts({
        targetName: "unauthorized-agent",
      }));
      expect(getResponseText(result)).toContain("not in your allowedAgents list");
      expect(getResponseText(result)).toContain("unauthorized-agent");
      expect(fakeRunAgent).not.toHaveBeenCalled();
    });

    it("rejects when allowedAgents is empty", async () => {
      const result = await delegateToAgent(makeOpts({
        agentConfig: { allowedAgents: [] },
      }));
      expect(getResponseText(result)).toContain("not in your allowedAgents list");
    });

    it("rejects when allowedAgents is undefined", async () => {
      const result = await delegateToAgent(makeOpts({
        agentConfig: {},
      }));
      expect(getResponseText(result)).toContain("not in your allowedAgents list");
    });

    it("allows when target is in allowedAgents", async () => {
      const result = await delegateToAgent(makeOpts());
      expect(getResponseText(result)).toContain("Response from target-agent");
    });
  });

  describe("target resolution", () => {
    it("returns error when target agent not found", async () => {
      mockAgentRepo.getAgentByName.mockResolvedValue(null);
      mockAgentRepo.listAgents.mockResolvedValue([]);
      const result = await delegateToAgent(makeOpts());
      expect(getResponseText(result)).toContain("not found");
    });

    it("handles default agent alias fallback", async () => {
      mockAgentRepo.getAgentByName.mockResolvedValue(null);
      mockAgentRepo.listAgents.mockResolvedValue([
        { id: "actual-default-id", name: "my-agent", tenantId: "tenant-1", config: {} },
      ]);

      await delegateToAgent(makeOpts({
        targetName: "default",
        agentConfig: { allowedAgents: ["default", "my-agent"] },
      }));
      expect(mockAgentRepo.listAgents).toHaveBeenCalledWith("tenant-1");
    });
  });

  describe("ask mode (synchronous)", () => {
    it("returns target agent response", async () => {
      const result = await delegateToAgent(makeOpts({ mode: "ask" }));
      expect(getResponseText(result)).toContain("Response from target-agent");
      expect(getResponseText(result)).toContain("mock response from target agent");
    });

    it("creates delegation session with stable key", async () => {
      await delegateToAgent(makeOpts());
      expect(mockSessionRepo.findOrCreateSession).toHaveBeenCalledWith(
        "target-agent-id",
        "agent:source-agent:target-agent",
        "untrusted",
      );
    });

    it("handles timeout", async () => {
      fakeRunAgent.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 10_000)));

      const result = await delegateToAgent(makeOpts({
        mode: "ask",
        timeoutSeconds: 1,
      }));
      expect(getResponseText(result)).toContain("did not respond within");
    }, 5000);
  });

  describe("tell mode (fire-and-forget)", () => {
    it("returns immediately with confirmation", async () => {
      const result = await delegateToAgent(makeOpts({ mode: "tell" }));
      expect(getResponseText(result)).toContain("Message sent to agent");
      expect(getResponseText(result)).toContain("target-agent");
    });

    it("does not wait for agent response", async () => {
      fakeRunAgent.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 10_000)));

      const start = Date.now();
      const result = await delegateToAgent(makeOpts({ mode: "tell" }));
      const elapsed = Date.now() - start;

      expect(getResponseText(result)).toContain("Message sent");
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe("delegation options passed to runAgent", () => {
    it("passes untrusted trust level", async () => {
      await delegateToAgent(makeOpts());
      expect(fakeRunAgent).toHaveBeenCalledWith(
        "Hello target",
        expect.objectContaining({
          trustLevel: "untrusted",
          agentId: "target-agent-id",
          delegationDepth: 1,
        }),
      );
    });

    it("increments delegation depth", async () => {
      await delegateToAgent(makeOpts({
        delegationContext: { depth: 1, callStack: ["agent-a"] },
      }));
      expect(fakeRunAgent).toHaveBeenCalledWith(
        "Hello target",
        expect.objectContaining({ delegationDepth: 2 }),
      );
    });

    it("appends source agent to call stack", async () => {
      await delegateToAgent(makeOpts({
        agentName: "agent-a",
        delegationContext: { depth: 0, callStack: [] },
      }));
      expect(fakeRunAgent).toHaveBeenCalledWith(
        "Hello target",
        expect.objectContaining({
          callStack: ["agent-a"],
        }),
      );
    });

    it("passes intersected caller boundaries", async () => {
      await delegateToAgent(makeOpts({
        agentConfig: {
          allowedAgents: ["target-agent"],
          boundaries: { allowBash: false, allowWebSearch: true },
        },
        delegationContext: {
          depth: 0,
          callStack: [],
          callerBoundaries: { allowBash: true, allowFileWrites: false },
        },
      }));

      // Intersection: bash=false (source says no), writes=false (caller says no), web=undefined (both ok)
      expect(fakeRunAgent).toHaveBeenCalledWith(
        "Hello target",
        expect.objectContaining({
          callerBoundaries: expect.objectContaining({
            allowBash: false,
            allowFileWrites: false,
          }),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("catches and returns runAgent errors in ask mode", async () => {
      fakeRunAgent.mockRejectedValueOnce(new Error("SDK exploded"));

      const result = await delegateToAgent(makeOpts({ mode: "ask" }));
      expect(getResponseText(result)).toContain("Error delegating");
      expect(getResponseText(result)).toContain("SDK exploded");
    });

    it("returns success for tell mode even if agent fails later", async () => {
      fakeRunAgent.mockRejectedValueOnce(new Error("SDK exploded"));

      const result = await delegateToAgent(makeOpts({ mode: "tell" }));
      expect(getResponseText(result)).toContain("Message sent");
    });
  });
});
