import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { AgentConfig } from "@ironclaw/shared";

/** Create a chainable mock db that handles select().from().where().groupBy().orderBy().limit() etc */
function createMockDb() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const proxy = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return undefined; // prevent promise-like behavior
          if (!chain[prop as string]) {
            chain[prop as string] = vi.fn().mockImplementation(() => proxy());
          }
          return chain[prop as string];
        },
      },
    );
  // The top-level db object
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "execute") {
          if (!chain.execute) chain.execute = vi.fn().mockResolvedValue([]);
          return chain.execute;
        }
        // select, insert, update, delete all return chainable
        return () => proxy();
      },
    },
  );
}

// Mock all shared repos
vi.mock("@ironclaw/shared", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ironclaw/shared");
  return {
    ...actual,
    db: createMockDb(),
    agentRepo: {
      getAgentById: vi.fn(),
      getAgentByName: vi.fn(),
      listAgents: vi.fn(),
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
    },
    sessionRepo: {
      findOrCreateSession: vi.fn().mockResolvedValue({ id: "session-1" }),
    },
    cronJobsRepo: {
      getAllJobs: vi.fn().mockResolvedValue([]),
      createJob: vi.fn(),
      updateJobStatus: vi.fn(),
      deleteJob: vi.fn(),
    },
    skillsRepo: {
      getAllSkills: vi.fn().mockResolvedValue([]),
    },
    channelsRepo: {
      getChannelConnections: vi.fn().mockResolvedValue([]),
    },
  };
});

// Need to also mock drizzle operations used directly in tools
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return { ...actual };
});

const { createManagementMcpServer } = await import("./sdk-agent.js");
const { agentRepo, cronJobsRepo, skillsRepo, channelsRepo } = await import("@ironclaw/shared");

const mockAgentRepo = agentRepo as unknown as {
  getAgentById: ReturnType<typeof vi.fn>;
  getAgentByName: ReturnType<typeof vi.fn>;
  listAgents: ReturnType<typeof vi.fn>;
  createAgent: ReturnType<typeof vi.fn>;
  deleteAgent: ReturnType<typeof vi.fn>;
};
const mockCronRepo = cronJobsRepo as unknown as {
  getAllJobs: ReturnType<typeof vi.fn>;
  createJob: ReturnType<typeof vi.fn>;
  updateJobStatus: ReturnType<typeof vi.fn>;
  deleteJob: ReturnType<typeof vi.fn>;
};
const mockSkillsRepo = skillsRepo as unknown as { getAllSkills: ReturnType<typeof vi.fn> };
const mockChannelsRepo = channelsRepo as unknown as { getChannelConnections: ReturnType<typeof vi.fn> };

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
type ToolMap = Record<string, { handler: ToolHandler }>;

const TEST_AGENT_ID = "agent-123";
const TEST_AGENT_INFO = {
  name: "test-agent",
  config: { persona: "general" as const, allowedAgents: [] } satisfies AgentConfig,
  tenantId: "tenant-1",
};

let tools: ToolMap;

beforeAll(() => {
  const server = createManagementMcpServer(TEST_AGENT_ID, undefined, TEST_AGENT_INFO);
  tools = (server.instance as unknown as { _registeredTools: ToolMap })._registeredTools;
});

beforeEach(() => {
  vi.resetAllMocks();
  mockCronRepo.getAllJobs.mockResolvedValue([]);
  mockSkillsRepo.getAllSkills.mockResolvedValue([]);
  mockChannelsRepo.getChannelConnections.mockResolvedValue([]);
  mockAgentRepo.listAgents.mockResolvedValue([]);
  mockAgentRepo.getAgentById.mockResolvedValue({
    id: TEST_AGENT_ID,
    name: "test-agent",
    tenantId: "tenant-1",
    config: { persona: "general" },
    workspaceConfig: {},
    createdAt: new Date(),
  });
});

function getText(result: { content: Array<{ text: string }> }): string {
  return result.content[0]!.text;
}

describe("management MCP tools", () => {
  it("has all expected tools registered", () => {
    const toolNames = Object.keys(tools);
    expect(toolNames).toContain("system_health");
    expect(toolNames).toContain("session_list");
    expect(toolNames).toContain("tool_logs");
    expect(toolNames).toContain("usage_metrics");
    expect(toolNames).toContain("agent_config");
    expect(toolNames).toContain("pending_approvals");
    expect(toolNames).toContain("cron_list");
    expect(toolNames).toContain("cron_manage");
    expect(toolNames).toContain("skills_list");
    expect(toolNames).toContain("channel_status");
    expect(toolNames).toContain("agent_list");
    expect(toolNames).toContain("agent_create");
    expect(toolNames).toContain("agent_delete");
    expect(toolNames).toContain("ask_agent");
    expect(toolNames).toContain("tell_agent");
  });

  describe("system_health", () => {
    it("returns health info", async () => {
      const result = await tools.system_health!.handler({});
      const text = getText(result);
      expect(text).toContain("Database:");
      expect(text).toContain("Uptime:");
      expect(text).toContain("Memory");
      expect(text).toContain("Node:");
    });
  });

  // agent_config, session_list, tool_logs, usage_metrics, and pending_approvals
  // use db.select() chains directly (not through repos), making them difficult
  // to mock without a full Drizzle chain mock. These are covered by integration
  // tests against real Postgres instead.

  describe("agent_list", () => {
    it("returns all agents", async () => {
      mockAgentRepo.listAgents.mockResolvedValue([
        { id: "a1", name: "agent-1", config: { persona: "developer" } },
        { id: "a2", name: "agent-2", config: { persona: "research" } },
      ]);

      const result = await tools.agent_list!.handler({});
      const text = getText(result);
      expect(text).toContain("agent-1");
      expect(text).toContain("agent-2");
      expect(text).toContain("developer");
      expect(text).toContain("Agents (2)");
    });

    it("returns message when no agents", async () => {
      mockAgentRepo.listAgents.mockResolvedValue([]);
      const result = await tools.agent_list!.handler({});
      expect(getText(result)).toContain("No agents");
    });
  });

  describe("agent_create", () => {
    it("creates an agent", async () => {
      mockAgentRepo.createAgent.mockResolvedValue({ id: "new-id", name: "new-bot" });
      const result = await tools.agent_create!.handler({ name: "new-bot", persona: "research" });
      expect(getText(result)).toContain("new-bot");
      expect(getText(result)).toContain("created");
    });

    it("rejects invalid agent names", async () => {
      const result = await tools.agent_create!.handler({ name: "has spaces" });
      expect(getText(result)).toContain("Error");
    });

    it("rejects reserved name 'default'", async () => {
      const result = await tools.agent_create!.handler({ name: "default" });
      expect(getText(result)).toContain("reserved");
    });

    it("validates model format", async () => {
      const result = await tools.agent_create!.handler({ name: "valid-name", model: "gpt-4" });
      expect(getText(result)).toContain("Error");
      expect(getText(result)).toContain("Invalid model");
    });
  });

  describe("agent_delete", () => {
    it("deletes an agent", async () => {
      mockAgentRepo.getAgentByName.mockResolvedValue({ id: "del-id", name: "to-delete" });
      mockAgentRepo.deleteAgent.mockResolvedValue(undefined);
      const result = await tools.agent_delete!.handler({ name: "to-delete" });
      expect(getText(result)).toContain("deleted");
    });

    it("returns error for non-existent agent", async () => {
      mockAgentRepo.getAgentByName.mockResolvedValue(null);
      const result = await tools.agent_delete!.handler({ name: "ghost" });
      expect(getText(result)).toContain("not found");
    });
  });

  describe("cron_list", () => {
    it("returns cron jobs", async () => {
      mockCronRepo.getAllJobs.mockResolvedValue([
        { id: "j1", schedule: "*/5 * * * *", sessionKey: "main", message: "check email", enabled: true, lastRunAt: null, nextRunAt: null },
      ]);
      const result = await tools.cron_list!.handler({});
      expect(getText(result)).toContain("*/5 * * * *");
      expect(getText(result)).toContain("check email");
    });

    it("returns message when no jobs", async () => {
      const result = await tools.cron_list!.handler({});
      expect(getText(result)).toContain("No cron jobs");
    });
  });

  describe("cron_manage", () => {
    it("creates a cron job", async () => {
      mockCronRepo.createJob.mockResolvedValue({ id: "new-job" });
      const result = await tools.cron_manage!.handler({
        action: "create",
        schedule: "0 9 * * *",
        session_key: "main",
        message: "good morning",
      });
      expect(getText(result)).toContain("Created");
    });

    it("rejects create without required fields", async () => {
      const result = await tools.cron_manage!.handler({ action: "create" });
      expect(getText(result)).toContain("Error");
    });

    it("rejects invalid cron expression", async () => {
      const result = await tools.cron_manage!.handler({
        action: "create",
        schedule: "not a cron",
        session_key: "main",
        message: "test",
      });
      expect(getText(result)).toContain("Invalid cron");
    });

    it("pauses a cron job", async () => {
      mockCronRepo.updateJobStatus.mockResolvedValue(true);
      const result = await tools.cron_manage!.handler({ action: "pause", id: "j1" });
      expect(getText(result)).toContain("Paused");
    });

    it("resumes a cron job", async () => {
      mockCronRepo.updateJobStatus.mockResolvedValue(true);
      const result = await tools.cron_manage!.handler({ action: "resume", id: "j1" });
      expect(getText(result)).toContain("Resumed");
    });

    it("deletes a cron job", async () => {
      mockCronRepo.deleteJob.mockResolvedValue(true);
      const result = await tools.cron_manage!.handler({ action: "delete", id: "j1" });
      expect(getText(result)).toContain("Deleted");
    });

    it("returns error for missing cron job", async () => {
      mockCronRepo.updateJobStatus.mockResolvedValue(false);
      const result = await tools.cron_manage!.handler({ action: "pause", id: "nonexistent" });
      expect(getText(result)).toContain("not found");
    });

    it("requires id for pause/resume/delete", async () => {
      const pause = await tools.cron_manage!.handler({ action: "pause" });
      expect(getText(pause)).toContain("Error");
      const resume = await tools.cron_manage!.handler({ action: "resume" });
      expect(getText(resume)).toContain("Error");
      const del = await tools.cron_manage!.handler({ action: "delete" });
      expect(getText(del)).toContain("Error");
    });
  });

  describe("skills_list", () => {
    it("returns skills", async () => {
      mockSkillsRepo.getAllSkills.mockResolvedValue([
        { name: "web-search", version: "1.0", enabled: true, manifest: { permissions: ["network:unrestricted"] } },
      ]);
      const result = await tools.skills_list!.handler({});
      expect(getText(result)).toContain("web-search");
    });

    it("returns message when no skills", async () => {
      const result = await tools.skills_list!.handler({});
      expect(getText(result)).toContain("No skills");
    });
  });

  describe("channel_status", () => {
    it("returns channel connections", async () => {
      mockChannelsRepo.getChannelConnections.mockResolvedValue([
        { channelType: "telegram", status: "active", createdAt: new Date() },
      ]);
      const result = await tools.channel_status!.handler({});
      expect(getText(result)).toContain("telegram");
      expect(getText(result)).toContain("active");
    });

    it("returns message when no channels", async () => {
      const result = await tools.channel_status!.handler({});
      expect(getText(result)).toContain("No channel connections");
    });
  });

  describe("ask_agent / tell_agent", () => {
    it("ask_agent errors when agentInfo not provided", async () => {
      const noInfoServer = createManagementMcpServer(TEST_AGENT_ID);
      const noInfoTools = (noInfoServer.instance as unknown as { _registeredTools: ToolMap })._registeredTools;
      const result = await noInfoTools.ask_agent!.handler({ agent_name: "other", message: "hi" });
      expect(getText(result)).toContain("not available");
    });

    it("tell_agent errors when agentInfo not provided", async () => {
      const noInfoServer = createManagementMcpServer(TEST_AGENT_ID);
      const noInfoTools = (noInfoServer.instance as unknown as { _registeredTools: ToolMap })._registeredTools;
      const result = await noInfoTools.tell_agent!.handler({ agent_name: "other", message: "hi" });
      expect(getText(result)).toContain("not available");
    });
  });
});
