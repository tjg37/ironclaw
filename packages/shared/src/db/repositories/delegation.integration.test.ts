import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as agentRepo from "./agents.js";
import * as sessionRepo from "./sessions.js";
import * as messageRepo from "./messages.js";
import { createTestAgent, cleanAllTables, getTestTenant, closeDb } from "../../test-utils/helpers.js";

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await cleanAllTables();
});

describe("delegation with real DB (integration)", () => {
  describe("agent resolution for delegation", () => {
    it("resolves target agent by name within the same tenant", async () => {
      await createTestAgent("source-agent", { allowedAgents: ["target-agent"] });
      const target = await createTestAgent("target-agent", { persona: "research" });

      const tenant = await getTestTenant();
      const found = await agentRepo.getAgentByName(tenant.id, "target-agent");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(target.id);
    });

    it("returns null when target agent does not exist", async () => {
      await createTestAgent("source-agent", { allowedAgents: ["nonexistent"] });

      const tenant = await getTestTenant();
      const found = await agentRepo.getAgentByName(tenant.id, "nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("allowedAgents config persistence", () => {
    it("persists allowedAgents through config updates", async () => {
      const agent = await createTestAgent("configurable-agent", {
        persona: "general",
        allowedAgents: ["agent-a", "agent-b"],
      });

      const config = await agentRepo.getAgentConfig(agent.id);
      expect(config.allowedAgents).toEqual(["agent-a", "agent-b"]);
    });

    it("updates allowedAgents without losing other config", async () => {
      const agent = await createTestAgent("update-test", {
        persona: "developer",
        boundaries: { allowBash: true },
        allowedAgents: ["old-agent"],
      });

      await agentRepo.updateAgentConfig(agent.id, {
        persona: "developer",
        boundaries: { allowBash: true },
        allowedAgents: ["new-agent-1", "new-agent-2"],
      });

      const updated = await agentRepo.getAgentConfig(agent.id);
      expect(updated.persona).toBe("developer");
      expect(updated.boundaries?.allowBash).toBe(true);
      expect(updated.allowedAgents).toEqual(["new-agent-1", "new-agent-2"]);
    });

    it("can clear allowedAgents", async () => {
      const agent = await createTestAgent("clear-test", {
        allowedAgents: ["some-agent"],
      });

      await agentRepo.updateAgentConfig(agent.id, {
        allowedAgents: [],
      });

      const updated = await agentRepo.getAgentConfig(agent.id);
      expect(updated.allowedAgents).toEqual([]);
    });
  });

  describe("delegation session creation", () => {
    it("creates isolated delegation sessions with stable keys", async () => {
      const source = await createTestAgent("source");
      const target = await createTestAgent("target");

      // Simulate the delegation session key format
      const delegationKey = `agent:${source.name}:${target.name}`;
      const session = await sessionRepo.findOrCreateSession(target.id, delegationKey, "untrusted");

      expect(session.sessionKey).toBe("agent:source:target");
      expect(session.trustLevel).toBe("untrusted");

      // Messages in delegation session
      await messageRepo.appendMessage(session.id, "user", "Delegated task");
      await messageRepo.appendMessage(session.id, "assistant", "Task completed");

      const msgs = await messageRepo.getSessionMessages(session.id);
      expect(msgs).toHaveLength(2);
    });

    it("accumulates conversation history across delegations", async () => {
      const source = await createTestAgent("repeat-source");
      const target = await createTestAgent("repeat-target");
      const sessionKey = `agent:${source.name}:${target.name}`;

      // First delegation
      const session1 = await sessionRepo.findOrCreateSession(target.id, sessionKey, "untrusted");
      await messageRepo.appendMessage(session1.id, "user", "First delegation");
      await messageRepo.appendMessage(session1.id, "assistant", "First response");

      // Second delegation — same session key
      const session2 = await sessionRepo.findOrCreateSession(target.id, sessionKey, "untrusted");
      expect(session2.id).toBe(session1.id); // Same session

      await messageRepo.appendMessage(session2.id, "user", "Second delegation");
      await messageRepo.appendMessage(session2.id, "assistant", "Second response");

      // All messages accumulated
      const allMsgs = await messageRepo.getSessionMessages(session1.id);
      expect(allMsgs).toHaveLength(4);
    });

    it("delegation sessions don't interfere with human sessions", async () => {
      const target = await createTestAgent("shared-target");

      const humanSession = await sessionRepo.findOrCreateSession(target.id, "main");
      const delegateSession = await sessionRepo.findOrCreateSession(target.id, "agent:caller:shared-target", "untrusted");

      await messageRepo.appendMessage(humanSession.id, "user", "Human says hi");
      await messageRepo.appendMessage(delegateSession.id, "user", "Agent says hi");

      expect(await messageRepo.getSessionMessageCount(humanSession.id)).toBe(1);
      expect(await messageRepo.getSessionMessageCount(delegateSession.id)).toBe(1);
    });
  });

  describe("cascade delete with delegation data", () => {
    it("deleting an agent removes its delegation sessions and messages", async () => {
      const source = await createTestAgent("del-source", { allowedAgents: ["del-target"] });
      const target = await createTestAgent("del-target");

      // Create a delegation session on the target
      const session = await sessionRepo.findOrCreateSession(target.id, `agent:${source.name}:${target.name}`, "untrusted");
      await messageRepo.appendMessage(session.id, "user", "Delegation task");

      // Delete the target agent — should cascade
      await agentRepo.deleteAgent(target.id);

      // Session and messages should be gone
      const foundSession = await sessionRepo.getSession(session.id);
      expect(foundSession).toBeNull();
    });
  });

  describe("multi-agent delegation chains", () => {
    it("supports creating sessions for multi-hop delegation", async () => {
      const agentA = await createTestAgent("agent-a", { allowedAgents: ["agent-b"] });
      const agentB = await createTestAgent("agent-b", { allowedAgents: ["agent-c"] });
      const agentC = await createTestAgent("agent-c");

      // A delegates to B
      const sessionAB = await sessionRepo.findOrCreateSession(agentB.id, `agent:${agentA.name}:${agentB.name}`, "untrusted");
      // B delegates to C
      const sessionBC = await sessionRepo.findOrCreateSession(agentC.id, `agent:${agentB.name}:${agentC.name}`, "untrusted");

      // All sessions are separate
      expect(sessionAB.id).not.toBe(sessionBC.id);

      await messageRepo.appendMessage(sessionAB.id, "user", "A asks B");
      await messageRepo.appendMessage(sessionBC.id, "user", "B asks C");

      expect(await messageRepo.getSessionMessageCount(sessionAB.id)).toBe(1);
      expect(await messageRepo.getSessionMessageCount(sessionBC.id)).toBe(1);
    });
  });
});
