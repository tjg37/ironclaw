import { describe, it, expect, vi, beforeEach } from "vitest";
import { isSensitivePath, isPathMountable, invalidateMountAllowlistCache, getConfigDir } from "./mount-allowlist.js";

describe("isSensitivePath", () => {
  it("detects .ssh directories", () => {
    expect(isSensitivePath("/home/user/.ssh/id_rsa")).toEqual({
      sensitive: true,
      reason: expect.stringContaining(".ssh"),
    });
  });

  it("detects .env files", () => {
    expect(isSensitivePath("/project/.env")).toEqual({
      sensitive: true,
      reason: expect.stringContaining(".env"),
    });
  });

  it("detects .env.local (prefix match)", () => {
    expect(isSensitivePath("/project/.env.local")).toEqual({
      sensitive: true,
      reason: expect.stringContaining(".env"),
    });
  });

  it("does not flag 'environment' as .env", () => {
    const result = isSensitivePath("/project/environment/config.json");
    expect(result.sensitive).toBe(false);
  });

  it("detects .git/config (multi-segment)", () => {
    expect(isSensitivePath("/project/.git/config")).toEqual({
      sensitive: true,
      reason: expect.stringContaining(".git/config"),
    });
  });

  it("does not flag .git directory alone", () => {
    const result = isSensitivePath("/project/.git/HEAD");
    expect(result.sensitive).toBe(false);
  });

  it("detects .pem file extension", () => {
    expect(isSensitivePath("/certs/server.pem")).toEqual({
      sensitive: true,
      reason: expect.stringContaining(".pem"),
    });
  });

  it("detects .key file extension", () => {
    expect(isSensitivePath("/certs/private.key")).toEqual({
      sensitive: true,
      reason: expect.stringContaining(".key"),
    });
  });

  it("detects .aws directory", () => {
    expect(isSensitivePath("/home/user/.aws/credentials")).toEqual({
      sensitive: true,
      reason: expect.stringContaining(".aws"),
    });
  });

  it("detects credentials.json", () => {
    expect(isSensitivePath("/project/credentials.json")).toEqual({
      sensitive: true,
      reason: expect.stringContaining("credentials.json"),
    });
  });

  it("is case-insensitive", () => {
    expect(isSensitivePath("/home/user/.SSH/id_rsa").sensitive).toBe(true);
    expect(isSensitivePath("/project/.ENV").sensitive).toBe(true);
  });

  it("allows safe paths", () => {
    expect(isSensitivePath("/project/src/index.ts").sensitive).toBe(false);
    expect(isSensitivePath("/project/package.json").sensitive).toBe(false);
    expect(isSensitivePath("/project/README.md").sensitive).toBe(false);
  });

  it("handles path traversal", () => {
    // path.resolve normalizes traversal
    expect(isSensitivePath("/project/../.ssh/id_rsa").sensitive).toBe(true);
  });
});

// Mock fs for isPathMountable tests
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("node:fs/promises");
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

const { readFile } = await import("node:fs/promises");
const { existsSync } = await import("node:fs");
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;

describe("isPathMountable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateMountAllowlistCache();
    mockExistsSync.mockReturnValue(true);
  });

  it("blocks sensitive paths regardless of allowlist", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: ["/"],
      denied: [],
    }));

    const result = await isPathMountable("/home/user/.ssh/id_rsa");
    expect(result).toEqual({
      allowed: false,
      reason: expect.stringContaining(".ssh"),
    });
  });

  it("allows paths within allowed directories", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: ["/Users/test/projects"],
      denied: [],
    }));

    const result = await isPathMountable("/Users/test/projects/myapp/src/index.ts");
    expect(result.allowed).toBe(true);
  });

  it("allows the allowed directory itself", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: ["/Users/test/projects"],
      denied: [],
    }));

    const result = await isPathMountable("/Users/test/projects");
    expect(result.allowed).toBe(true);
  });

  it("rejects paths outside allowed directories", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: ["/Users/test/projects"],
      denied: [],
    }));

    const result = await isPathMountable("/Users/test/other/file.ts");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not within any allowed directory");
  });

  it("rejects paths matching user-configured denied patterns", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: ["/Users/test/projects"],
      denied: ["secret-data"],
    }));

    const result = await isPathMountable("/Users/test/projects/secret-data/file.txt");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("denied pattern");
  });

  it("rejects all paths when allowlist is empty", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: [],
      denied: [],
    }));

    const result = await isPathMountable("/some/safe/path.ts");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No directories in mount allowlist");
  });

  it("handles missing config file (no allowlist)", async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await isPathMountable("/some/path.ts");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No directories in mount allowlist");
  });

  it("handles malformed config file gracefully", async () => {
    mockReadFile.mockResolvedValue("not valid json {{{");

    const result = await isPathMountable("/some/path.ts");
    expect(result.allowed).toBe(false);
  });

  it("handles config with invalid allowed field", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: "not-an-array",
    }));

    const result = await isPathMountable("/some/path.ts");
    expect(result.allowed).toBe(false);
  });

  it("denied patterns are case-insensitive", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: ["/projects"],
      denied: ["SecretDir"],
    }));

    const result = await isPathMountable("/projects/secretdir/file.txt");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("denied pattern");
  });

  it("uses cached config on second call within TTL", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: ["/projects"],
      denied: [],
    }));

    await isPathMountable("/projects/file1.ts");
    await isPathMountable("/projects/file2.ts");

    // readFile should only be called once (second call uses cache)
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("handles config with invalid denied field (non-string array)", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      allowed: ["/projects"],
      denied: [123, null],
    }));

    const result = await isPathMountable("/projects/file.ts");
    // Invalid denied field is ignored, path should be allowed
    expect(result.allowed).toBe(true);
  });
});

describe("getConfigDir", () => {
  it("returns a non-empty string path", () => {
    const dir = getConfigDir();
    expect(dir).toBeTruthy();
    expect(typeof dir).toBe("string");
    expect(dir).toContain("ironclaw");
  });
});
