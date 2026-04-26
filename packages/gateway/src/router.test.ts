import { describe, it, expect } from "vitest";
import { resolveSessionKey } from "./router.js";

describe("resolveSessionKey", () => {
  it("returns 'main' for CLI channel", () => {
    expect(resolveSessionKey("cli", "user-1")).toBe("main");
  });

  it("returns 'main' for webchat channel", () => {
    expect(resolveSessionKey("webchat", "client-uuid")).toBe("main");
  });

  describe("telegram", () => {
    it("returns 'main' for operator", () => {
      expect(resolveSessionKey("telegram", "12345", undefined, "12345")).toBe("main");
    });

    it("returns group key for negative chat IDs", () => {
      expect(resolveSessionKey("telegram", "12345", "-67890", "99999")).toBe("group:telegram:-67890");
    });

    it("returns DM key for non-operator users", () => {
      expect(resolveSessionKey("telegram", "12345", undefined, "99999")).toBe("dm:telegram:12345");
    });

    it("returns DM key when no operator ID is set", () => {
      expect(resolveSessionKey("telegram", "12345")).toBe("dm:telegram:12345");
    });

    it("returns DM key for positive chat IDs (not a group)", () => {
      expect(resolveSessionKey("telegram", "12345", "12345", "99999")).toBe("dm:telegram:12345");
    });
  });

  it("returns DM key for unknown channels", () => {
    expect(resolveSessionKey("discord", "user-abc")).toBe("dm:discord:user-abc");
    expect(resolveSessionKey("slack", "U123")).toBe("dm:slack:U123");
  });
});
