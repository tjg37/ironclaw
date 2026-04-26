import { describe, it, expect } from "vitest";
import { buildCorsOrigins, getCorsHeaders, CORS_ALLOWED_METHODS } from "./cors.js";

describe("getCorsHeaders", () => {
  const allowed = buildCorsOrigins();

  it("advertises all HTTP methods the gateway actually serves", () => {
    // If you add a new verb in server.ts, update this list too so browsers don't
    // reject preflights. Regression guard for the PATCH bug we hit in PR #26.
    const headers = getCorsHeaders(allowed);
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(headers["Access-Control-Allow-Methods"]).toContain(method);
    }
    expect(headers["Access-Control-Allow-Methods"]).toBe(CORS_ALLOWED_METHODS);
  });

  it("allows localhost:3000 by default", () => {
    const headers = getCorsHeaders(allowed, { headers: { origin: "http://localhost:3000" } });
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
  });

  it("includes a configured CORS_ALLOWED_ORIGIN when the request matches", () => {
    const custom = buildCorsOrigins("https://app.example.com");
    const headers = getCorsHeaders(custom, { headers: { origin: "https://app.example.com" } });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
  });

  it("rejects unknown origins by echoing the default", () => {
    const headers = getCorsHeaders(allowed, { headers: { origin: "https://evil.example" } });
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
  });

  it("allows Content-Type header (needed for JSON POST/PATCH)", () => {
    const headers = getCorsHeaders(allowed);
    expect(headers["Access-Control-Allow-Headers"]).toContain("Content-Type");
  });
});
