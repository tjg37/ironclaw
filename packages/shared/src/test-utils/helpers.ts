/**
 * Test helpers for integration tests.
 * Provides factory functions for creating test data and cleanup utilities.
 */
import { db } from "../db/connection.js";
import { tenants, agents } from "../db/schema.js";
import * as agentRepo from "../db/repositories/agents.js";
import type { AgentConfig } from "../types/agent-config.js";
import { sql } from "drizzle-orm";

let testTenantId: string | null = null;

/** Get or create the test tenant */
export async function getTestTenant(): Promise<{ id: string; name: string }> {
  if (testTenantId) {
    return { id: testTenantId, name: "test-tenant" };
  }
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "test-tenant" })
    .returning();
  testTenantId = tenant!.id;
  return { id: testTenantId, name: "test-tenant" };
}

/** Create a test agent with optional config overrides */
export async function createTestAgent(
  name: string,
  config: AgentConfig = {},
): Promise<typeof agents.$inferSelect> {
  const tenant = await getTestTenant();
  return agentRepo.createAgent(tenant.id, name, config);
}

/** Clean all data from test tables using TRUNCATE CASCADE */
export async function cleanAllTables(): Promise<void> {
  await db.execute(sql`TRUNCATE tenants, agents, sessions, messages, memory_entries, tool_executions, credentials, skills, cron_jobs, channel_connections CASCADE`);
  testTenantId = null;
}

/** Close the database connection (call in afterAll) */
export async function closeDb(): Promise<void> {
  const { client } = await import("../db/connection.js");
  await client.end();
}
