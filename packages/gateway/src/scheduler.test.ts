import { describe, it, expect } from "vitest";
import { buildCronFireSessionKey } from "./scheduler.js";

describe("buildCronFireSessionKey", () => {
  it("appends an ISO timestamp to the base key", () => {
    const key = buildCronFireSessionKey("cron:sentry-fixer", new Date("2026-04-19T15:20:00.000Z"));
    expect(key).toBe("cron:sentry-fixer:2026-04-19T15-20-00");
  });

  it("produces a different key for different firing times (session isolation per fire)", () => {
    const a = buildCronFireSessionKey("cron:watchdog", new Date("2026-04-19T10:00:00.000Z"));
    const b = buildCronFireSessionKey("cron:watchdog", new Date("2026-04-19T10:02:00.000Z"));
    expect(a).not.toBe(b);
  });

  it("always starts with the base key followed by ':'", () => {
    const key = buildCronFireSessionKey("cron:anything");
    expect(key.startsWith("cron:anything:")).toBe(true);
  });

  it("does not contain '.' in the suffix (milliseconds stripped for readability)", () => {
    const key = buildCronFireSessionKey("cron:x", new Date("2026-04-19T15:20:00.123Z"));
    expect(key).not.toContain(".");
  });
});
