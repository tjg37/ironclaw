import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("defaults authMode to api_key", async () => {
    delete process.env["AUTH_MODE"];
    const { config } = await import("./config.js");
    expect(config.authMode).toBe("api_key");
  });

  it("accepts max_plan auth mode", async () => {
    process.env["AUTH_MODE"] = "max_plan";
    const { config } = await import("./config.js");
    expect(config.authMode).toBe("max_plan");
  });

  it("falls back to api_key for invalid auth mode", async () => {
    process.env["AUTH_MODE"] = "invalid_mode";
    const { config } = await import("./config.js");
    expect(config.authMode).toBe("api_key");
  });

  it("reads anthropic model from env", async () => {
    process.env["ANTHROPIC_MODEL"] = "claude-opus-4-20250514";
    const { config } = await import("./config.js");
    expect(config.anthropicModel).toBe("claude-opus-4-20250514");
  });

  it("has sensible defaults for all fields", async () => {
    const { config } = await import("./config.js");
    expect(config.anthropicModel).toBeTruthy();
    expect(config.anthropicFastModel).toBeTruthy();
    expect(config.databaseUrl).toContain("postgres://");
  });
});
