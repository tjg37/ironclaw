import Docker from "dockerode";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SandboxOptions {
  sessionId: string;
  trustLevel: string;
  command: string[];
  workingDir?: string;
  timeoutMs?: number;
  memoryLimitMb?: number;
  cpuLimit?: number;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_LIMIT_MB = 256;
const DEFAULT_CPU_LIMIT = 0.5;

/** Maximum concurrent sandbox containers to prevent resource exhaustion */
const MAX_CONCURRENT_CONTAINERS = parseInt(process.env["IRONCLAW_MAX_SANDBOX_CONTAINERS"] ?? "10", 10);

const SANDBOX_IMAGE = process.env["SANDBOX_IMAGE"] ?? "node:22-slim";
const SANDBOX_DATA_DIR = process.env["SANDBOX_DATA_DIR"] ?? "/tmp/ironclaw-sandbox";

/** Pattern for valid session IDs — alphanumeric, hyphens, underscores, colons, and dots only */
const VALID_SESSION_ID = /^[a-zA-Z0-9_:.-]+$/;

// Cached Docker client (lazy singleton)
let dockerInstance: Docker | null = null;
function getDocker(): Docker {
  if (!dockerInstance) {
    dockerInstance = new Docker();
  }
  return dockerInstance;
}

// Concurrency tracking
let activeContainerCount = 0;

/**
 * Find the monorepo root by walking up from this file looking for pnpm-workspace.yaml.
 * Works regardless of whether we're running from src/ or dist/.
 */
function findProjectRoot(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume 2 levels up from shared/src/
  return join(thisDir, "../..");
}

const PROJECT_ROOT = findProjectRoot();

/**
 * Validate that a session ID is safe to use in filesystem paths and container names.
 * Prevents path traversal attacks via crafted session IDs.
 */
function validateSessionId(sessionId: string): void {
  if (!sessionId || !VALID_SESSION_ID.test(sessionId)) {
    throw new Error(
      `Invalid session ID: "${sessionId}". Must contain only alphanumeric characters, hyphens, underscores, colons, and dots.`,
    );
  }
  // Double-check: no path traversal sequences even within valid chars
  if (sessionId.includes("..")) {
    throw new Error(`Invalid session ID: "${sessionId}". Must not contain "..".`);
  }
}

/**
 * Pull the sandbox base image if it is not already present locally.
 */
export async function ensureSandboxImage(): Promise<void> {
  const docker = getDocker();
  try {
    await docker.getImage(SANDBOX_IMAGE).inspect();
    console.log(`[sandbox] Image "${SANDBOX_IMAGE}" already present`);
  } catch {
    console.log(`[sandbox] Pulling image "${SANDBOX_IMAGE}"...`);
    const stream = await docker.pull(SANDBOX_IMAGE);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null) => (err ? reject(err) : resolve()),
      );
    });
    console.log(`[sandbox] Image "${SANDBOX_IMAGE}" pulled successfully`);
  }
}

/**
 * Remove the per-session writable directory from the host.
 */
export async function cleanupSessionSandbox(sessionId: string): Promise<void> {
  validateSessionId(sessionId);
  const sessionDir = join(SANDBOX_DATA_DIR, sessionId);
  try {
    await rm(sessionDir, { recursive: true, force: true });
    console.log(`[sandbox] Cleaned up session directory: ${sessionDir}`);
  } catch (err) {
    console.error(`[sandbox] Failed to clean up session directory: ${sessionDir}`, err);
  }
}

/**
 * Run a command inside an ephemeral Docker container with full hardening:
 * - Ephemeral container (removed after execution)
 * - Read-only source mount at /app
 * - Per-session writable directory at /workspace
 * - Non-root execution (uid 1000)
 * - CPU and memory limits
 * - Execution timeout
 * - Network isolation (no network access)
 * - Concurrent container limit
 */
export async function runInSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const {
    sessionId,
    command,
    workingDir = "/workspace",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    memoryLimitMb = DEFAULT_MEMORY_LIMIT_MB,
    cpuLimit = DEFAULT_CPU_LIMIT,
  } = options;

  // Validate session ID to prevent path traversal
  validateSessionId(sessionId);

  // Enforce concurrent container limit
  if (activeContainerCount >= MAX_CONCURRENT_CONTAINERS) {
    throw new Error(
      `Sandbox concurrency limit reached (${MAX_CONCURRENT_CONTAINERS} active containers). Try again later.`,
    );
  }

  const docker = getDocker();
  // Use random suffix to prevent container name collisions under concurrency
  const suffix = randomBytes(4).toString("hex");
  const containerName = `ironclaw-sandbox-${sessionId}-${Date.now()}-${suffix}`;
  const sessionDir = join(SANDBOX_DATA_DIR, sessionId);

  // Ensure the per-session writable directory exists on the host
  // and is writable by uid 1000 (the non-root user inside the container).
  // mkdir's mode is masked by umask, so we chmod explicitly after creation.
  await mkdir(sessionDir, { recursive: true });
  await chmod(sessionDir, 0o777);

  // CPU quota: Docker uses NanoCPUs (1e9 = 1 core)
  const nanoCpus = Math.round(cpuLimit * 1e9);

  console.log(`[sandbox] Creating container "${containerName}" for session "${sessionId}"`);

  const container = await docker.createContainer({
    Image: SANDBOX_IMAGE,
    name: containerName,
    Cmd: command,
    WorkingDir: workingDir,
    User: "1000",
    HostConfig: {
      AutoRemove: false, // We remove manually to capture logs even on failure
      ReadonlyRootfs: false, // Some tools need /tmp etc. inside container
      Memory: memoryLimitMb * 1024 * 1024,
      NanoCpus: nanoCpus,
      Binds: [
        // Read-only source mount
        `${PROJECT_ROOT}/src:/app/src:ro`,
        `${PROJECT_ROOT}/packages:/app/packages:ro`,
        `${PROJECT_ROOT}/package.json:/app/package.json:ro`,
        // Mount all tsconfig files read-only
        `${PROJECT_ROOT}/tsconfig.base.json:/app/tsconfig.base.json:ro`,
        // Per-session writable workspace
        `${sessionDir}:/workspace:rw`,
      ],
      NetworkMode: "none", // No network access for sandboxed execution
    },
  });

  activeContainerCount++;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    await container.start();
    console.log(`[sandbox] Container "${containerName}" started (active: ${activeContainerCount})`);

    // Set up timeout
    const waitPromise = container.wait();
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill();
        } catch {
          // Container may have already exited
        }
        reject(new Error("Container execution timed out"));
      }, timeoutMs);
    });

    let exitCode: number;
    try {
      const waitResult = await Promise.race([waitPromise, timeoutPromise]);
      exitCode = (waitResult as { StatusCode: number }).StatusCode;
    } catch {
      // Timeout or kill error
      exitCode = 137; // SIGKILL
    }

    if (timeoutHandle) clearTimeout(timeoutHandle);

    // Capture stdout and stderr
    const stdoutStream = await container.logs({ stdout: true, stderr: false, follow: false });
    const stderrStream = await container.logs({ stdout: false, stderr: true, follow: false });

    // Docker multiplexed streams have 8-byte headers per frame.
    // container.logs returns a Buffer or string depending on options.
    const stdout = demuxDockerStream(stdoutStream);
    const stderr = demuxDockerStream(stderrStream);

    console.log(`[sandbox] Container "${containerName}" exited with code ${exitCode} (timedOut=${timedOut})`);

    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
    };
  } finally {
    activeContainerCount--;
    // Always remove the container
    try {
      await container.remove({ force: true });
      console.log(`[sandbox] Container "${containerName}" removed (active: ${activeContainerCount})`);
    } catch (err) {
      console.error(`[sandbox] Failed to remove container "${containerName}":`, err);
    }
  }
}

/**
 * Demux Docker multiplexed stream output.
 * Docker log streams use an 8-byte header per frame:
 *   [stream_type(1)][0(3)][size(4)][payload(size)]
 * If the input is a string, return it directly (non-TTY mode may return plain text).
 */
function demuxDockerStream(data: Buffer | NodeJS.ReadableStream | string): string {
  if (typeof data === "string") {
    return data;
  }

  if (!Buffer.isBuffer(data)) {
    // If it's a readable stream that was already consumed, return empty
    return "";
  }

  const buf = data as Buffer;
  if (buf.length === 0) return "";

  // Check if this looks like a multiplexed stream (first byte is 0, 1, or 2)
  if (buf.length >= 8 && buf[0] !== undefined && buf[0] <= 2) {
    const parts: string[] = [];
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset + 4);
      const payload = buf.subarray(offset + 8, offset + 8 + size);
      parts.push(payload.toString("utf-8"));
      offset += 8 + size;
    }
    return parts.join("").trimEnd();
  }

  // Not multiplexed, return as plain text
  return buf.toString("utf-8").trimEnd();
}
