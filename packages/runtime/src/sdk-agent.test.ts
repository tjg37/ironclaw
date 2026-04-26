import { describe, it, expect } from "vitest";
import { getAllowedTools, intersectBoundaries } from "./sdk-agent.js";

describe("getAllowedTools", () => {
  it("grants all 8 tools for operator trust level", () => {
    const tools = getAllowedTools("operator");
    expect(tools).toEqual(["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"]);
  });

  it("grants all 8 tools for trusted (Bash is approval-gated at runtime, not excluded)", () => {
    const tools = getAllowedTools("trusted");
    expect(tools).toEqual(["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"]);
  });

  it("grants all 8 tools for untrusted (write/shell/network are approval-gated at runtime)", () => {
    const tools = getAllowedTools("untrusted");
    expect(tools).toEqual(["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"]);
  });

  it("grants all 8 tools for unknown trust levels (the hook still gates at runtime)", () => {
    const tools = getAllowedTools("unknown");
    expect(tools).toEqual(["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"]);
  });

  describe("boundary restrictions", () => {
    it("removes Bash when allowBash is false", () => {
      const tools = getAllowedTools("operator", { allowBash: false });
      expect(tools).not.toContain("Bash");
      expect(tools).toContain("Read"); // other tools still present
    });

    it("removes Write and Edit when allowFileWrites is false", () => {
      const tools = getAllowedTools("operator", { allowFileWrites: false });
      expect(tools).not.toContain("Write");
      expect(tools).not.toContain("Edit");
      expect(tools).toContain("Read");
      expect(tools).toContain("Bash");
    });

    it("removes WebSearch and WebFetch when allowWebSearch is false", () => {
      const tools = getAllowedTools("operator", { allowWebSearch: false });
      expect(tools).not.toContain("WebSearch");
      expect(tools).not.toContain("WebFetch");
      expect(tools).toContain("Bash");
    });

    it("can combine multiple restrictions", () => {
      const tools = getAllowedTools("operator", {
        allowBash: false,
        allowFileWrites: false,
        allowWebSearch: false,
      });
      expect(tools).toEqual(["Read", "Glob", "Grep"]);
    });

    it("boundaries restrict regardless of trust level (untrusted + allowBash:false strips Bash)", () => {
      const tools = getAllowedTools("untrusted", { allowBash: false });
      expect(tools).not.toContain("Bash");
    });
  });
});

describe("intersectBoundaries", () => {
  it("returns undefined when both are undefined", () => {
    expect(intersectBoundaries(undefined, undefined)).toBeUndefined();
  });

  it("returns the other when one is undefined", () => {
    const b = { allowBash: false };
    expect(intersectBoundaries(undefined, b)).toEqual(b);
    expect(intersectBoundaries(b, undefined)).toEqual(b);
  });

  it("returns the most restrictive combination", () => {
    const a = { allowBash: true, allowFileWrites: false };
    const b = { allowBash: false, allowFileWrites: true };
    const result = intersectBoundaries(a, b);
    // Both must allow for the result to allow
    expect(result?.allowBash).toBe(false);
    expect(result?.allowFileWrites).toBe(false);
  });

  it("allows when both allow", () => {
    const a = { allowWebSearch: true };
    const b = { allowWebSearch: true };
    const result = intersectBoundaries(a, b);
    // undefined means "not restricted" (permitted by default)
    expect(result?.allowWebSearch).toBeUndefined();
  });

  it("restricts when either restricts", () => {
    const a = { allowBash: true, allowWebSearch: true };
    const b = { allowBash: false, allowWebSearch: true };
    const result = intersectBoundaries(a, b);
    expect(result?.allowBash).toBe(false);
    expect(result?.allowWebSearch).toBeUndefined();
  });

  it("handles all four boundary keys", () => {
    const a = { allowBash: false, allowFileWrites: true, allowWebSearch: true, allowSystemFiles: false };
    const b = { allowBash: true, allowFileWrites: false, allowWebSearch: false, allowSystemFiles: true };
    const result = intersectBoundaries(a, b);
    expect(result?.allowBash).toBe(false);
    expect(result?.allowFileWrites).toBe(false);
    expect(result?.allowWebSearch).toBe(false);
    expect(result?.allowSystemFiles).toBe(false);
  });
});
