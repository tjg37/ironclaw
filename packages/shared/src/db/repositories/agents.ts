import { eq, and, inArray } from "drizzle-orm";
import { db } from "../connection.js";
import { tenants, agents, sessions, messages, memoryEntries, credentials, skills, cronJobs, channelConnections } from "../schema.js";
import { validateAgentConfig } from "../../types/agent-config.js";
import type { AgentConfig } from "../../types/agent-config.js";

export async function findOrCreateDefaultTenant() {
  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.name, "default"))
    .limit(1);

  if (existing.length > 0) {
    return existing[0]!;
  }

  const [created] = await db
    .insert(tenants)
    .values({ name: "default" })
    .returning();

  return created!;
}

export async function findOrCreateDefaultAgent(tenantId: string) {
  const existing = await db
    .select()
    .from(agents)
    .where(eq(agents.name, "default"))
    .limit(1);

  if (existing.length > 0) {
    return existing[0]!;
  }

  const [created] = await db
    .insert(agents)
    .values({ tenantId, name: "default", config: {}, workspaceConfig: {} })
    .returning();

  return created!;
}

export async function getAgentConfig(agentId: string): Promise<AgentConfig> {
  const rows = await db
    .select({ config: agents.config })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (rows.length === 0) {
    console.warn(`[agents] getAgentConfig: no agent found for id "${agentId}", returning defaults`);
    return {};
  }
  return (rows[0]!.config ?? {}) as AgentConfig;
}

export async function updateAgentConfig(agentId: string, config: AgentConfig): Promise<void> {
  validateAgentConfig(config);
  await db.update(agents).set({ config }).where(eq(agents.id, agentId));
}

export async function createAgent(
  tenantId: string,
  name: string,
  config: AgentConfig = {},
): Promise<typeof agents.$inferSelect> {
  if (config && Object.keys(config).length > 0) {
    validateAgentConfig(config);
  }

  try {
    const [created] = await db
      .insert(agents)
      .values({ tenantId, name, config, workspaceConfig: {} })
      .returning();
    return created!;
  } catch (err) {
    // Unique constraint violation (duplicate name within tenant)
    if (err instanceof Error && err.message.includes("agents_tenant_id_name_idx")) {
      throw new Error(`Agent "${name}" already exists`);
    }
    throw err;
  }
}

export async function listAgents(tenantId: string): Promise<Array<typeof agents.$inferSelect>> {
  return db.select().from(agents).where(eq(agents.tenantId, tenantId));
}

export async function getAgentByName(
  tenantId: string,
  name: string,
): Promise<(typeof agents.$inferSelect) | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.name, name)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAgentById(id: string): Promise<(typeof agents.$inferSelect) | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteAgent(agentId: string): Promise<void> {
  const agent = await getAgentById(agentId);
  if (!agent) throw new Error("Agent not found");
  if (agent.name === "default") throw new Error("Cannot delete the default agent");

  await db.transaction(async (tx) => {
    // Subquery: all session IDs for this agent
    const sessionIds = tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.agentId, agentId));

    // Delete all related data in one pass per table (no N+1)
    await tx.delete(messages).where(inArray(messages.sessionId, sessionIds));
    await tx.delete(sessions).where(eq(sessions.agentId, agentId));
    await tx.delete(memoryEntries).where(eq(memoryEntries.agentId, agentId));
    await tx.delete(credentials).where(eq(credentials.agentId, agentId));
    await tx.delete(skills).where(eq(skills.agentId, agentId));
    await tx.delete(cronJobs).where(eq(cronJobs.agentId, agentId));
    await tx.delete(channelConnections).where(eq(channelConnections.agentId, agentId));
    await tx.delete(agents).where(eq(agents.id, agentId));
  });
}

export async function renameAgent(agentId: string, newName: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(newName)) {
    throw new Error("Agent name must be 1-64 characters, using only letters, numbers, hyphens, and underscores");
  }
  const agent = await getAgentById(agentId);
  if (!agent) throw new Error("Agent not found");
  if (agent.name === "default") throw new Error("Cannot rename the default agent");
  if (newName === "default") throw new Error('Cannot rename an agent to "default" — that name is reserved');

  try {
    await db.update(agents).set({ name: newName }).where(eq(agents.id, agentId));
  } catch (err) {
    if (err instanceof Error && err.message.includes("agents_tenant_id_name_idx")) {
      throw new Error(`Agent "${newName}" already exists`);
    }
    throw err;
  }
}
