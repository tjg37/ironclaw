import { describe, it, expect } from "vitest";
import { validateAgentConfig, AGENT_NAME_REGEX, PERSONA_KEYS } from "./agent-config.js";

describe("AGENT_NAME_REGEX", () => {
  it("accepts valid agent names", () => {
    expect(AGENT_NAME_REGEX.test("default")).toBe(true);
    expect(AGENT_NAME_REGEX.test("code-reviewer")).toBe(true);
    expect(AGENT_NAME_REGEX.test("research_bot")).toBe(true);
    expect(AGENT_NAME_REGEX.test("Agent123")).toBe(true);
    expect(AGENT_NAME_REGEX.test("a")).toBe(true);
    expect(AGENT_NAME_REGEX.test("a".repeat(64))).toBe(true);
  });

  it("rejects invalid agent names", () => {
    expect(AGENT_NAME_REGEX.test("")).toBe(false);
    expect(AGENT_NAME_REGEX.test("a".repeat(65))).toBe(false);
    expect(AGENT_NAME_REGEX.test("has spaces")).toBe(false);
    expect(AGENT_NAME_REGEX.test("has.dots")).toBe(false);
    expect(AGENT_NAME_REGEX.test("special!chars")).toBe(false);
    expect(AGENT_NAME_REGEX.test("path/traversal")).toBe(false);
  });
});

describe("validateAgentConfig", () => {
  it("accepts an empty config", () => {
    expect(validateAgentConfig({})).toEqual({});
  });

  it("accepts all valid persona types", () => {
    for (const persona of PERSONA_KEYS) {
      if (persona === "custom") {
        expect(validateAgentConfig({ persona, customPersona: "My custom persona" })).toHaveProperty("persona", persona);
      } else {
        expect(validateAgentConfig({ persona })).toHaveProperty("persona", persona);
      }
    }
  });

  it("rejects invalid persona", () => {
    expect(() => validateAgentConfig({ persona: "invalid" })).toThrow("Invalid persona");
    expect(() => validateAgentConfig({ persona: 123 })).toThrow("Invalid persona");
  });

  it("requires customPersona when persona is custom", () => {
    expect(() => validateAgentConfig({ persona: "custom" })).toThrow("customPersona is required");
    expect(() => validateAgentConfig({ persona: "custom", customPersona: "" })).toThrow("customPersona is required");
    expect(() => validateAgentConfig({ persona: "custom", customPersona: "   " })).toThrow("customPersona is required");
  });

  it("enforces customPersona max length", () => {
    expect(() => validateAgentConfig({ persona: "custom", customPersona: "a".repeat(1001) })).toThrow("1000 characters");
    expect(validateAgentConfig({ persona: "custom", customPersona: "a".repeat(1000) })).toHaveProperty("persona", "custom");
  });

  it("validates boundaries", () => {
    expect(validateAgentConfig({ boundaries: { allowBash: true, allowFileWrites: false } }))
      .toHaveProperty("boundaries");
  });

  it("rejects invalid boundary keys", () => {
    expect(() => validateAgentConfig({ boundaries: { unknownKey: true } })).toThrow("Unknown boundary key");
  });

  it("rejects non-boolean boundary values", () => {
    expect(() => validateAgentConfig({ boundaries: { allowBash: "yes" } })).toThrow("must be a boolean");
  });

  it("rejects non-object boundaries", () => {
    expect(() => validateAgentConfig({ boundaries: "string" })).toThrow("boundaries must be an object");
    expect(() => validateAgentConfig({ boundaries: null })).toThrow("boundaries must be an object");
  });

  it("validates model format", () => {
    expect(validateAgentConfig({ model: "claude-sonnet-4-20250514" })).toHaveProperty("model");
    expect(validateAgentConfig({ model: "claude-haiku-4-5-20251001" })).toHaveProperty("model");
  });

  it("rejects invalid model format", () => {
    expect(() => validateAgentConfig({ model: "gpt-4" })).toThrow("Must start with");
    expect(() => validateAgentConfig({ model: "claude-" })).toThrow(); // empty after prefix
    expect(() => validateAgentConfig({ model: 123 })).toThrow("Invalid model");
  });

  it("validates mcpConnections", () => {
    expect(validateAgentConfig({ mcpConnections: ["memory"] })).toHaveProperty("mcpConnections");
    expect(validateAgentConfig({ mcpConnections: ["memory", "github"] })).toHaveProperty("mcpConnections");
  });

  it("rejects invalid mcpConnections", () => {
    expect(() => validateAgentConfig({ mcpConnections: "memory" })).toThrow("must be an array");
    expect(() => validateAgentConfig({ mcpConnections: ["invalid"] })).toThrow("Invalid MCP connection");
  });

  it("validates allowedAgents", () => {
    expect(validateAgentConfig({ allowedAgents: [] })).toHaveProperty("allowedAgents");
    expect(validateAgentConfig({ allowedAgents: ["code-reviewer", "research-bot"] })).toHaveProperty("allowedAgents");
  });

  it("rejects invalid allowedAgents", () => {
    expect(() => validateAgentConfig({ allowedAgents: "not-array" })).toThrow("must be an array");
    expect(() => validateAgentConfig({ allowedAgents: ["has spaces"] })).toThrow("Invalid agent name");
    expect(() => validateAgentConfig({ allowedAgents: [123] })).toThrow("Invalid agent name");
    expect(() => validateAgentConfig({ allowedAgents: ["a".repeat(65)] })).toThrow("Invalid agent name");
  });

  it("rejects non-object config", () => {
    expect(() => validateAgentConfig("string")).toThrow("must be a plain object");
    expect(() => validateAgentConfig(null)).toThrow("must be a plain object");
    expect(() => validateAgentConfig([1, 2])).toThrow("must be a plain object");
  });
});
