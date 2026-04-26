import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// Mock shared repos
vi.mock("@ironclaw/shared", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ironclaw/shared");
  return {
    ...actual,
    memoryRepo: {
      storeMemory: vi.fn(),
      searchMemory: vi.fn(),
      getRecentMemories: vi.fn(),
      deleteMemory: vi.fn(),
    },
  };
});

const { createMemoryMcpServer } = await import("./sdk-agent.js");
const { memoryRepo } = await import("@ironclaw/shared");

const mockMemoryRepo = memoryRepo as unknown as {
  storeMemory: ReturnType<typeof vi.fn>;
  searchMemory: ReturnType<typeof vi.fn>;
  getRecentMemories: ReturnType<typeof vi.fn>;
  deleteMemory: ReturnType<typeof vi.fn>;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
type ToolMap = Record<string, { handler: ToolHandler }>;

const TEST_AGENT_ID = "agent-mem-123";
let tools: ToolMap;

beforeAll(() => {
  const server = createMemoryMcpServer(TEST_AGENT_ID);
  tools = (server.instance as unknown as { _registeredTools: ToolMap })._registeredTools;
});

beforeEach(() => {
  vi.clearAllMocks();
});

function getText(result: { content: Array<{ text: string }> }): string {
  return result.content[0]!.text;
}

describe("memory MCP tools", () => {
  it("has all expected tools registered", () => {
    const toolNames = Object.keys(tools);
    expect(toolNames).toContain("memory_store");
    expect(toolNames).toContain("memory_search");
    expect(toolNames).toContain("memory_list");
    expect(toolNames).toContain("memory_delete");
    expect(toolNames).toContain("memory_forget");
  });

  describe("memory_store", () => {
    it("stores a memory entry", async () => {
      mockMemoryRepo.storeMemory.mockResolvedValue({ id: "mem-1", content: "test fact" });
      const result = await tools.memory_store!.handler({ content: "test fact" });
      expect(getText(result)).toContain("Stored memory");
      expect(getText(result)).toContain("test fact");
      expect(mockMemoryRepo.storeMemory).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: TEST_AGENT_ID, content: "test fact" }),
      );
    });

    it("uses default source 'conversation'", async () => {
      mockMemoryRepo.storeMemory.mockResolvedValue({ id: "mem-2" });
      await tools.memory_store!.handler({ content: "test" });
      expect(mockMemoryRepo.storeMemory).toHaveBeenCalledWith(
        expect.objectContaining({ source: "conversation" }),
      );
    });

    it("accepts custom source", async () => {
      mockMemoryRepo.storeMemory.mockResolvedValue({ id: "mem-3" });
      await tools.memory_store!.handler({ content: "test", source: "user_stated" });
      expect(mockMemoryRepo.storeMemory).toHaveBeenCalledWith(
        expect.objectContaining({ source: "user_stated" }),
      );
    });

    it("returns error on empty content", async () => {
      const result = await tools.memory_store!.handler({ content: "" });
      expect(getText(result)).toContain("Error");
    });

    it("handles store errors gracefully", async () => {
      mockMemoryRepo.storeMemory.mockRejectedValue(new Error("DB down"));
      const result = await tools.memory_store!.handler({ content: "test" });
      expect(getText(result)).toContain("Error");
      expect(getText(result)).toContain("DB down");
    });
  });

  describe("memory_search", () => {
    it("returns search results", async () => {
      mockMemoryRepo.searchMemory.mockResolvedValue([
        { id: "m1", content: "User likes TypeScript", score: 0.9, source: "conversation", createdAt: new Date("2026-01-01") },
        { id: "m2", content: "User works at Acme", score: 0.7, source: "user_stated", createdAt: new Date("2026-01-02") },
      ]);
      const result = await tools.memory_search!.handler({ query: "user preferences" });
      const text = getText(result);
      expect(text).toContain("Found 2");
      expect(text).toContain("TypeScript");
      expect(text).toContain("Acme");
      expect(text).toContain("0.90");
    });

    it("returns message when no results", async () => {
      mockMemoryRepo.searchMemory.mockResolvedValue([]);
      const result = await tools.memory_search!.handler({ query: "nonexistent" });
      expect(getText(result)).toContain("No matching memories");
    });

    it("clamps limit to valid range", async () => {
      mockMemoryRepo.searchMemory.mockResolvedValue([]);
      await tools.memory_search!.handler({ query: "test", limit: 100 });
      expect(mockMemoryRepo.searchMemory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    it("returns error on empty query", async () => {
      const result = await tools.memory_search!.handler({ query: "" });
      expect(getText(result)).toContain("Error");
    });
  });

  describe("memory_list", () => {
    it("returns recent memories", async () => {
      mockMemoryRepo.getRecentMemories.mockResolvedValue([
        { id: "m1", content: "fact one", source: "conversation" },
        { id: "m2", content: "fact two", source: "user_stated" },
      ]);
      const result = await tools.memory_list!.handler({});
      const text = getText(result);
      expect(text).toContain("2 memories");
      expect(text).toContain("fact one");
      expect(text).toContain("fact two");
    });

    it("returns message when no memories", async () => {
      mockMemoryRepo.getRecentMemories.mockResolvedValue([]);
      const result = await tools.memory_list!.handler({});
      expect(getText(result)).toContain("No memories stored");
    });

    it("clamps limit", async () => {
      mockMemoryRepo.getRecentMemories.mockResolvedValue([]);
      await tools.memory_list!.handler({ limit: 100 });
      expect(mockMemoryRepo.getRecentMemories).toHaveBeenCalledWith(TEST_AGENT_ID, 50);
    });
  });

  describe("memory_delete", () => {
    it("deletes a memory by ID", async () => {
      mockMemoryRepo.deleteMemory.mockResolvedValue(true);
      const result = await tools.memory_delete!.handler({ id: "550e8400-e29b-41d4-a716-446655440000" });
      expect(getText(result)).toContain("Deleted");
    });

    it("returns error for non-existent memory", async () => {
      mockMemoryRepo.deleteMemory.mockResolvedValue(false);
      const result = await tools.memory_delete!.handler({ id: "550e8400-e29b-41d4-a716-446655440000" });
      expect(getText(result)).toContain("not found");
    });

    it("rejects invalid UUID format", async () => {
      const result = await tools.memory_delete!.handler({ id: "not-a-uuid" });
      expect(getText(result)).toContain("Invalid memory ID");
    });

    it("returns error on empty ID", async () => {
      const result = await tools.memory_delete!.handler({ id: "" });
      expect(getText(result)).toContain("Error");
    });
  });

  describe("memory_forget", () => {
    it("deletes all matching memories", async () => {
      mockMemoryRepo.searchMemory.mockResolvedValue([
        { id: "m1" }, { id: "m2" }, { id: "m3" },
      ]);
      mockMemoryRepo.deleteMemory.mockResolvedValue(true);

      const result = await tools.memory_forget!.handler({ query: "sensitive info" });
      expect(getText(result)).toContain("Forgot 3");
      expect(mockMemoryRepo.deleteMemory).toHaveBeenCalledTimes(3);
    });

    it("returns message when nothing to forget", async () => {
      mockMemoryRepo.searchMemory.mockResolvedValue([]);
      const result = await tools.memory_forget!.handler({ query: "nonexistent" });
      expect(getText(result)).toContain("No matching memories");
    });

    it("returns error on empty query", async () => {
      const result = await tools.memory_forget!.handler({ query: "" });
      expect(getText(result)).toContain("Error");
    });
  });
});
