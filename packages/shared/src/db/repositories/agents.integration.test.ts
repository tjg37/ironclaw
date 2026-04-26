import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as agentRepo from "./agents.js";
import { createTestAgent, cleanAllTables, getTestTenant, closeDb } from "../../test-utils/helpers.js";

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await cleanAllTables();
});

describe("agent CRUD (integration)", () => {
  describe("createAgent", () => {
    it("creates an agent with config", async () => {
      const tenant = await getTestTenant();
      const agent = await agentRepo.createAgent(tenant.id, "test-agent", {
        persona: "developer",
        boundaries: { allowBash: true, allowFileWrites: false },
        mcpConnections: ["memory"],
      });

      expect(agent.name).toBe("test-agent");
      expect(agent.config).toEqual(expect.objectContaining({
        persona: "developer",
        boundaries: { allowBash: true, allowFileWrites: false },
      }));
    });

    it("creates an agent with empty config", async () => {
      const tenant = await getTestTenant();
      const agent = await agentRepo.createAgent(tenant.id, "minimal-agent");
      expect(agent.name).toBe("minimal-agent");
    });

    it("rejects duplicate agent names within same tenant", async () => {
      const tenant = await getTestTenant();
      await agentRepo.createAgent(tenant.id, "unique-agent");
      await expect(agentRepo.createAgent(tenant.id, "unique-agent")).rejects.toThrow("already exists");
    });

    it("validates config before saving", async () => {
      const tenant = await getTestTenant();
      await expect(
        agentRepo.createAgent(tenant.id, "bad-config", { persona: "invalid" as never }),
      ).rejects.toThrow("Invalid persona");
    });
  });

  describe("getAgentByName", () => {
    it("finds an existing agent", async () => {
      const created = await createTestAgent("findable-agent", { persona: "research" });
      const tenant = await getTestTenant();
      const found = await agentRepo.getAgentByName(tenant.id, "findable-agent");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it("returns null for non-existent agent", async () => {
      const tenant = await getTestTenant();
      const found = await agentRepo.getAgentByName(tenant.id, "ghost-agent");
      expect(found).toBeNull();
    });
  });

  describe("getAgentById", () => {
    it("finds an existing agent by ID", async () => {
      const created = await createTestAgent("id-lookup-agent");
      const found = await agentRepo.getAgentById(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("id-lookup-agent");
    });

    it("returns null for non-existent ID", async () => {
      const found = await agentRepo.getAgentById("00000000-0000-0000-0000-000000000000");
      expect(found).toBeNull();
    });
  });

  describe("listAgents", () => {
    it("returns all agents for a tenant", async () => {
      await createTestAgent("agent-1");
      await createTestAgent("agent-2");
      await createTestAgent("agent-3");
      const tenant = await getTestTenant();
      const all = await agentRepo.listAgents(tenant.id);
      expect(all).toHaveLength(3);
      expect(all.map((a) => a.name).sort()).toEqual(["agent-1", "agent-2", "agent-3"]);
    });

    it("returns empty array for empty tenant", async () => {
      const tenant = await getTestTenant();
      const all = await agentRepo.listAgents(tenant.id);
      expect(all).toEqual([]);
    });
  });

  describe("updateAgentConfig", () => {
    it("updates agent config", async () => {
      const agent = await createTestAgent("updatable-agent", { persona: "general" });
      await agentRepo.updateAgentConfig(agent.id, {
        persona: "developer",
        boundaries: { allowBash: true },
        allowedAgents: ["other-agent"],
      });

      const updated = await agentRepo.getAgentConfig(agent.id);
      expect(updated.persona).toBe("developer");
      expect(updated.boundaries?.allowBash).toBe(true);
      expect(updated.allowedAgents).toEqual(["other-agent"]);
    });

    it("validates config before updating", async () => {
      const agent = await createTestAgent("validate-update");
      await expect(
        agentRepo.updateAgentConfig(agent.id, { persona: "invalid" as never }),
      ).rejects.toThrow("Invalid persona");
    });
  });

  describe("deleteAgent", () => {
    it("deletes an agent and cascades", async () => {
      const agent = await createTestAgent("deletable-agent");
      await agentRepo.deleteAgent(agent.id);
      const found = await agentRepo.getAgentById(agent.id);
      expect(found).toBeNull();
    });

    it("rejects deleting the default agent", async () => {
      const tenant = await getTestTenant();
      const defaultAgent = await agentRepo.createAgent(tenant.id, "default");
      await expect(agentRepo.deleteAgent(defaultAgent.id)).rejects.toThrow("Cannot delete");
    });

    it("throws for non-existent agent", async () => {
      await expect(
        agentRepo.deleteAgent("00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow("Agent not found");
    });
  });

  describe("renameAgent", () => {
    it("renames an agent", async () => {
      const agent = await createTestAgent("old-name");
      await agentRepo.renameAgent(agent.id, "new-name");
      const found = await agentRepo.getAgentById(agent.id);
      expect(found!.name).toBe("new-name");
    });

    it("rejects renaming to default", async () => {
      const agent = await createTestAgent("some-agent");
      await expect(agentRepo.renameAgent(agent.id, "default")).rejects.toThrow("reserved");
    });

    it("rejects renaming the default agent", async () => {
      const tenant = await getTestTenant();
      const defaultAgent = await agentRepo.createAgent(tenant.id, "default");
      await expect(agentRepo.renameAgent(defaultAgent.id, "new-name")).rejects.toThrow("Cannot rename");
    });

    it("rejects invalid names", async () => {
      const agent = await createTestAgent("valid-agent");
      await expect(agentRepo.renameAgent(agent.id, "has spaces")).rejects.toThrow("must be 1-64 characters");
    });

    it("rejects duplicate names", async () => {
      await createTestAgent("existing-name");
      const agent = await createTestAgent("to-rename");
      await expect(agentRepo.renameAgent(agent.id, "existing-name")).rejects.toThrow("already exists");
    });
  });

  describe("findOrCreateDefaultAgent", () => {
    it("creates a default agent on first call", async () => {
      const tenant = await getTestTenant();
      const agent = await agentRepo.findOrCreateDefaultAgent(tenant.id);
      expect(agent.name).toBe("default");
      expect(agent.id).toBeDefined();
    });

    it("returns the same agent on subsequent calls", async () => {
      const tenant = await getTestTenant();
      const first = await agentRepo.findOrCreateDefaultAgent(tenant.id);
      const second = await agentRepo.findOrCreateDefaultAgent(tenant.id);
      expect(first.id).toBe(second.id);
    });
  });

  describe("getAgentConfig", () => {
    it("returns empty config for non-existent agent", async () => {
      const config = await agentRepo.getAgentConfig("00000000-0000-0000-0000-000000000000");
      expect(config).toEqual({});
    });
  });

  describe("findOrCreateDefaultTenant", () => {
    it("creates a default tenant on first call", async () => {
      const tenant = await agentRepo.findOrCreateDefaultTenant();
      expect(tenant.name).toBe("default");
      expect(tenant.id).toBeDefined();
    });

    it("returns the same tenant on subsequent calls", async () => {
      const first = await agentRepo.findOrCreateDefaultTenant();
      const second = await agentRepo.findOrCreateDefaultTenant();
      expect(first.id).toBe(second.id);
    });
  });
});
