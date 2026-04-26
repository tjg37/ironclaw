import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, normalize, sep } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Mount allowlist — controls what host directories can be mounted into sandbox containers.
 *
 * Stored at ~/.config/ironclaw/mount-allowlist.json, OUTSIDE the workspace directory
 * so a compromised agent cannot modify its own permissions.
 *
 * Format:
 * {
 *   "allowed": ["/Users/me/projects", "/Users/me/data"],
 *   "denied": [".ssh", ".gnupg", ".aws", ".env", "private_key", ".secret",
 *              ".git/config", ".npmrc", "credentials.json", ".gcloud",
 *              ".docker/config.json", "id_rsa"]
 * }
 */

const CONFIG_DIR = process.env["IRONCLAW_CONFIG_DIR"]
  ?? join(homedir(), ".config", "ironclaw");

const ALLOWLIST_PATH = join(CONFIG_DIR, "mount-allowlist.json");

/**
 * Sensitive path SEGMENT patterns — matched against individual path segments
 * (between / separators) to avoid false positives from substring matching.
 * E.g., ".env" matches the segment ".env" but not "environment".
 */
const BUILTIN_SENSITIVE_SEGMENTS = new Set([
  ".ssh", ".gnupg", ".gpg", ".aws", ".secret", ".secrets",
  ".npmrc", ".gcloud", ".pgpass", ".netrc", ".boto",
  "id_rsa", "id_ed25519", "id_ecdsa", "private_key",
  "credentials.json",
]);

/**
 * Sensitive patterns that match the START of a segment.
 * E.g., ".env" matches ".env", ".env.local", ".env.production".
 */
const BUILTIN_SENSITIVE_PREFIXES = [
  ".env",
];

/**
 * Sensitive multi-segment paths — matched as contiguous sequences.
 * E.g., ".git/config" matches only when ".git" is followed by "config".
 */
const BUILTIN_SENSITIVE_PATHS = [
  [".git", "config"],
  [".docker", "config.json"],
  [".kube", "config"],
];

const BUILTIN_SENSITIVE_EXTENSIONS = [
  ".pem", ".key", ".p12", ".pfx", ".jks", ".keystore",
];

interface MountAllowlistConfig {
  allowed: string[];
  denied?: string[];
}

let cachedConfig: MountAllowlistConfig | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000; // reload every 60 seconds

async function loadConfig(): Promise<MountAllowlistConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  if (!existsSync(ALLOWLIST_PATH)) {
    // No allowlist file = no extra mounts allowed (only built-in mounts)
    cachedConfig = { allowed: [], denied: [] };
    cacheTime = now;
    return cachedConfig;
  }

  try {
    const raw = await readFile(ALLOWLIST_PATH, "utf-8");
    const parsed = JSON.parse(raw) as MountAllowlistConfig;

    if (!Array.isArray(parsed.allowed) || !parsed.allowed.every((p: unknown) => typeof p === "string")) {
      console.error("[mount-allowlist] Invalid config: 'allowed' must be an array of strings");
      cachedConfig = { allowed: [], denied: [] };
    } else if (parsed.denied && (!Array.isArray(parsed.denied) || !parsed.denied.every((p: unknown) => typeof p === "string"))) {
      console.error("[mount-allowlist] Invalid config: 'denied' must be an array of strings");
      cachedConfig = { allowed: parsed.allowed, denied: [] };
    } else {
      cachedConfig = parsed;
    }
  } catch (err) {
    console.error("[mount-allowlist] Failed to load config:", err);
    cachedConfig = { allowed: [], denied: [] };
  }

  cacheTime = now;
  return cachedConfig!;
}

/**
 * Split a normalized absolute path into its segments.
 * E.g., "/home/user/.ssh/id_rsa" → ["home", "user", ".ssh", "id_rsa"]
 */
function getSegments(normalizedPath: string): string[] {
  return normalizedPath.split(sep).filter(Boolean);
}

/**
 * Check if a path contains sensitive segments using segment-based matching.
 * This avoids false positives from substring matching (e.g., "environment" won't match ".env").
 *
 * Uses case-insensitive matching for macOS compatibility where the filesystem
 * is case-insensitive but path APIs preserve case.
 */
function matchesSensitivePattern(normalizedPath: string): { matches: boolean; reason?: string } {
  const segments = getSegments(normalizedPath);
  const segmentsLower = segments.map((s) => s.toLowerCase());
  const filename = segments[segments.length - 1] ?? "";
  const filenameLower = filename.toLowerCase();

  // Check exact segment matches
  for (const pattern of BUILTIN_SENSITIVE_SEGMENTS) {
    const patternLower = pattern.toLowerCase();
    if (segmentsLower.includes(patternLower)) {
      return { matches: true, reason: `Contains sensitive path segment: "${pattern}"` };
    }
  }

  // Check prefix matches (e.g., ".env" matches ".env.local")
  for (const prefix of BUILTIN_SENSITIVE_PREFIXES) {
    const prefixLower = prefix.toLowerCase();
    if (segmentsLower.some((s) => s === prefixLower || s.startsWith(prefixLower + "."))) {
      return { matches: true, reason: `Contains sensitive path prefix: "${prefix}"` };
    }
  }

  // Check multi-segment path matches (e.g., ".git/config")
  for (const pathParts of BUILTIN_SENSITIVE_PATHS) {
    const partsLower = pathParts.map((p) => p.toLowerCase());
    for (let i = 0; i <= segmentsLower.length - partsLower.length; i++) {
      if (partsLower.every((part, j) => segmentsLower[i + j] === part)) {
        return { matches: true, reason: `Contains sensitive path: "${pathParts.join("/")}"` };
      }
    }
  }

  // Check sensitive file extensions
  for (const ext of BUILTIN_SENSITIVE_EXTENSIONS) {
    if (filenameLower.endsWith(ext.toLowerCase())) {
      return { matches: true, reason: `Has sensitive extension: "${ext}"` };
    }
  }

  return { matches: false };
}

/**
 * Check if a host path is allowed to be mounted into a sandbox container.
 *
 * Rules (in order):
 * 1. Built-in sensitive patterns are ALWAYS blocked
 * 2. User-configured denied patterns are blocked
 * 3. Path must be within an allowed directory
 */
export async function isPathMountable(hostPath: string): Promise<{ allowed: boolean; reason?: string }> {
  const normalized = normalize(resolve(hostPath));

  // Rule 1: Check built-in sensitive patterns (segment-based)
  const sensitiveCheck = matchesSensitivePattern(normalized);
  if (sensitiveCheck.matches) {
    return { allowed: false, reason: sensitiveCheck.reason };
  }

  // Rule 2: Check user-configured denied patterns
  const config = await loadConfig();
  if (config.denied) {
    const segments = getSegments(normalized);
    const segmentsLower = segments.map((s) => s.toLowerCase());
    for (const pattern of config.denied) {
      const patternLower = pattern.toLowerCase();
      if (segmentsLower.includes(patternLower)) {
        return { allowed: false, reason: `Path matches denied pattern: "${pattern}"` };
      }
    }
  }

  // Rule 3: Path must be within an allowed directory
  if (config.allowed.length === 0) {
    return { allowed: false, reason: "No directories in mount allowlist" };
  }

  for (const allowedDir of config.allowed) {
    const resolvedAllowed = normalize(resolve(allowedDir));
    // Unambiguous containment check: path must start with allowedDir + separator
    if (normalized === resolvedAllowed || normalized.startsWith(resolvedAllowed + sep)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `Path "${normalized}" is not within any allowed directory` };
}

/**
 * Validate a path for sensitive content — used by both sandbox mounts and file tools.
 * This is the adversarial-resistant version that handles:
 * - Path traversal (../)
 * - Normalized paths
 * - Case insensitivity (for macOS compatibility)
 * - Segment-based matching (no false positives from substrings)
 */
export function isSensitivePath(path: string): { sensitive: boolean; reason?: string } {
  const normalized = normalize(resolve(path));
  const check = matchesSensitivePattern(normalized);
  return { sensitive: check.matches, reason: check.reason };
}

/** Get the config directory path (for documentation/setup purposes) */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/** Force reload the config on next access */
export function invalidateMountAllowlistCache(): void {
  cachedConfig = null;
  cacheTime = 0;
}
