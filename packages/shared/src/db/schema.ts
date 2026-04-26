import { pgTable, uuid, text, timestamp, jsonb, boolean, integer, customType, uniqueIndex } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Custom type for pgvector
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(512)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

// --- Tenants ---

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamptz("created_at").defaultNow(),
});

// --- Agents ---

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  workspaceConfig: jsonb("workspace_config").notNull().default({}),
  createdAt: timestamptz("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("agents_tenant_id_name_idx").on(table.tenantId, table.name),
]);

// --- Sessions ---

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  sessionKey: text("session_key").notNull(),
  trustLevel: text("trust_level").notNull().default("operator"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamptz("created_at").defaultNow(),
  updatedAt: timestamptz("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("sessions_agent_id_session_key_idx").on(table.agentId, table.sessionKey),
]);

// --- Messages ---

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").references(() => sessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").default({}),
  parentId: uuid("parent_id"),
  createdAt: timestamptz("created_at").defaultNow(),
});

// --- Memory Entries ---

export const memoryEntries = pgTable("memory_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  source: text("source"),
  sourceSessionId: uuid("source_session_id").references(() => sessions.id),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamptz("created_at").defaultNow(),
});

// --- Tool Executions ---

export const toolExecutions = pgTable("tool_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").references(() => sessions.id),
  toolName: text("tool_name").notNull(),
  permissionsUsed: text("permissions_used").array().notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  status: text("status").notNull(),
  approvalRequired: boolean("approval_required").default(false),
  approvedAt: timestamptz("approved_at"),
  executedAt: timestamptz("executed_at"),
  durationMs: integer("duration_ms"),
  createdAt: timestamptz("created_at").defaultNow(),
});

// --- Credentials ---

export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  service: text("service").notNull(),
  scope: text("scope").notNull(),
  encryptedData: text("encrypted_data").notNull(), // base64-encoded AES-256-GCM
  createdAt: timestamptz("created_at").defaultNow(),
});

// --- Skills ---

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  name: text("name").notNull(),
  version: text("version").notNull(),
  manifest: jsonb("manifest").notNull(),
  content: text("content").notNull(),
  enabled: boolean("enabled").default(true),
  sandboxed: boolean("sandboxed").default(true),
  createdAt: timestamptz("created_at").defaultNow(),
});

// --- Cron Jobs ---

export const cronJobs = pgTable("cron_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  schedule: text("schedule").notNull(),
  sessionKey: text("session_key").notNull(),
  message: text("message").notNull(),
  toolPermissions: text("tool_permissions").array(),
  enabled: boolean("enabled").default(true),
  lastRunAt: timestamptz("last_run_at"),
  nextRunAt: timestamptz("next_run_at"),
  createdAt: timestamptz("created_at").defaultNow(),
});

// --- Channel Connections ---

export const channelConnections = pgTable("channel_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id),
  channelType: text("channel_type").notNull(),
  config: jsonb("config").notNull(),
  status: text("status").default("active"),
  createdAt: timestamptz("created_at").defaultNow(),
});
