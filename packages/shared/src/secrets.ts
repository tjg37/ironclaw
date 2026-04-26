import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db } from "./db/connection.js";
import { credentials } from "./db/schema.js";

/**
 * AES-256-GCM credential vault.
 *
 * Credentials are encrypted at rest in PostgreSQL. The encryption key
 * comes from the IRONCLAW_ENCRYPTION_KEY environment variable — it
 * NEVER goes in the database. The database stores only encrypted blobs.
 *
 * All queries are scoped by agent_id to enforce per-agent isolation.
 *
 * Encrypted format: "v1:" + base64(iv + authTag + ciphertext)
 * The "v1:" prefix enables future key rotation — if the key changes,
 * a new version prefix (v2:) can be used and old entries re-encrypted.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = "v1";

const MAX_SERVICE_LENGTH = 255;
const MAX_SCOPE_LENGTH = 255;

// Cached encryption key (lazy singleton — parsed once from env, never re-read)
let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const keyHex = process.env["IRONCLAW_ENCRYPTION_KEY"];
  if (!keyHex) {
    throw new Error(
      "IRONCLAW_ENCRYPTION_KEY is required for credential storage. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("IRONCLAW_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
  }

  cachedKey = key;

  // In production, clear the env var so it's not accessible via process.env after init.
  // Skip in test to avoid breaking other test modules in the same process.
  if (process.env["NODE_ENV"] !== "test" && process.env["VITEST"] === undefined) {
    delete process.env["IRONCLAW_ENCRYPTION_KEY"];
  }

  return cachedKey;
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: "v1:" + base64(iv + authTag + ciphertext)
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return `${CURRENT_KEY_VERSION}:${combined.toString("base64")}`;
}

function decrypt(encryptedValue: string): string {
  const key = getEncryptionKey();

  // Parse key version prefix
  let base64Data: string;
  if (encryptedValue.startsWith("v1:")) {
    base64Data = encryptedValue.slice(3);
  } else if (encryptedValue.includes(":")) {
    const version = encryptedValue.split(":")[0];
    throw new Error(`Unsupported encryption key version: "${version}". Re-encrypt with current key.`);
  } else {
    // Legacy data without version prefix (pre-versioning)
    base64Data = encryptedValue;
  }

  const combined = Buffer.from(base64Data, "base64");

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted data: too short");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

function validateInputs(service: string, scope: string): void {
  if (!service || typeof service !== "string") {
    throw new Error("service is required and must be a non-empty string");
  }
  if (!scope || typeof scope !== "string") {
    throw new Error("scope is required and must be a non-empty string");
  }
  if (service.length > MAX_SERVICE_LENGTH) {
    throw new Error(`service must be at most ${MAX_SERVICE_LENGTH} characters`);
  }
  if (scope.length > MAX_SCOPE_LENGTH) {
    throw new Error(`scope must be at most ${MAX_SCOPE_LENGTH} characters`);
  }
}

/**
 * Store an encrypted credential. Agent ID is mandatory for isolation.
 * If a credential for the same agent+service already exists, it is updated.
 */
export async function storeCredential(params: {
  agentId: string;
  service: string;
  scope: string;
  data: Record<string, unknown>;
}): Promise<string> {
  validateInputs(params.service, params.scope);
  const encryptedData = encrypt(JSON.stringify(params.data));

  // Upsert: update existing or insert new
  const [existing] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.agentId, params.agentId), eq(credentials.service, params.service)))
    .limit(1);

  if (existing) {
    await db
      .update(credentials)
      .set({ scope: params.scope, encryptedData })
      .where(eq(credentials.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(credentials)
    .values({
      agentId: params.agentId,
      service: params.service,
      scope: params.scope,
      encryptedData,
    })
    .returning();

  return created!.id;
}

/**
 * Retrieve and decrypt a credential. Agent ID required for isolation.
 * Returns the most recently created credential if duplicates exist.
 */
export async function getCredential(
  agentId: string,
  service: string,
): Promise<{ id: string; service: string; scope: string; data: Record<string, unknown> } | null> {
  const [row] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.agentId, agentId), eq(credentials.service, service)))
    .orderBy(desc(credentials.createdAt))
    .limit(1);

  if (!row) return null;

  const data = JSON.parse(decrypt(row.encryptedData)) as Record<string, unknown>;
  return {
    id: row.id,
    service: row.service,
    scope: row.scope,
    data,
  };
}

/**
 * List credentials for an agent (without decrypting data).
 */
export async function listCredentials(
  agentId: string,
): Promise<Array<{ id: string; service: string; scope: string; createdAt: Date | null }>> {
  const rows = await db
    .select({
      id: credentials.id,
      service: credentials.service,
      scope: credentials.scope,
      createdAt: credentials.createdAt,
    })
    .from(credentials)
    .where(eq(credentials.agentId, agentId))
    .orderBy(desc(credentials.createdAt));

  return rows;
}

/**
 * Delete a credential. Agent ID required for isolation.
 */
export async function deleteCredential(id: string, agentId: string): Promise<boolean> {
  const result = await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.agentId, agentId)))
    .returning();

  return result.length > 0;
}
