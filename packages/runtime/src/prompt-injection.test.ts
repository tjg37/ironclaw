import { describe, it, expect } from "vitest";
import { wrapToolResult, addSourceMetadata, buildInjectionDefensePrompt } from "./prompt-injection.js";
import type { InboundMessage } from "@ironclaw/shared";

describe("wrapToolResult", () => {
  it("wraps a successful result", () => {
    const result = wrapToolResult("memory_search", { success: true, output: "Found 3 results" });
    expect(result).toContain('name="memory_search"');
    expect(result).toContain('status="success"');
    expect(result).toContain("Found 3 results");
  });

  it("wraps an error result", () => {
    const result = wrapToolResult("bash", { success: false, output: "", error: "Permission denied" });
    expect(result).toContain('status="error"');
    expect(result).toContain("Permission denied");
  });

  it("uses output when error is not present on failure", () => {
    const result = wrapToolResult("bash", { success: false, output: "Fallback error" });
    expect(result).toContain("Fallback error");
  });

  it("escapes XML characters in tool name", () => {
    const result = wrapToolResult('tool"with<special>&chars', { success: true, output: "ok" });
    expect(result).toContain("&quot;");
    expect(result).toContain("&lt;");
    expect(result).toContain("&amp;");
  });
});

describe("addSourceMetadata", () => {
  it("adds source metadata to a message", () => {
    const msg = {
      id: "test-id",
      sessionKey: "main",
      channel: "telegram",
      senderId: "12345",
      content: "Hello",
    };
    const result = addSourceMetadata(msg);
    expect(result.metadata?.sourceChannel).toBe("telegram");
    expect(result.metadata?.senderId).toBe("12345");
    expect(result.metadata?.processedAt).toBeDefined();
  });

  it("preserves existing metadata", () => {
    const msg = {
      id: "test-id",
      sessionKey: "main",
      channel: "webchat",
      senderId: "user-1",
      content: "Hello",
      metadata: { existing: "value" },
    };
    const result = addSourceMetadata(msg);
    expect(result.metadata?.existing).toBe("value");
    expect(result.metadata?.sourceChannel).toBe("webchat");
  });

  it("does not mutate the original message", () => {
    const msg: InboundMessage = {
      id: "test-id",
      sessionKey: "main",
      channel: "cli",
      senderId: "user-1",
      content: "Hello",
    };
    const result = addSourceMetadata(msg);
    expect(result).not.toBe(msg);
    expect(msg.metadata).toBeUndefined();
  });
});

describe("buildInjectionDefensePrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildInjectionDefensePrompt();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("contains key security instructions", () => {
    const prompt = buildInjectionDefensePrompt();
    expect(prompt).toContain("prompt-injection-defense");
    expect(prompt).toContain("tool-result");
    expect(prompt).toContain("operator");
    expect(prompt).toContain("system prompt");
  });
});
