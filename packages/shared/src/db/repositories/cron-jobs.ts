import cron from "node-cron";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../connection.js";
import { cronJobs, agents } from "../schema.js";

/** Cron jobs MUST NOT target the "main" session — that's operator-level trust */
const BLOCKED_SESSION_KEYS = new Set(["main"]);

export async function getEnabledJobs(agentId: string) {
  return db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.agentId, agentId), eq(cronJobs.enabled, true)));
}

export async function getAllEnabledJobs() {
  return db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.enabled, true));
}

/** List every cron job with its owning agent's name, newest first. For UI listing. */
export async function listAllWithAgent() {
  return db
    .select({
      id: cronJobs.id,
      agentId: cronJobs.agentId,
      agentName: agents.name,
      schedule: cronJobs.schedule,
      sessionKey: cronJobs.sessionKey,
      message: cronJobs.message,
      enabled: cronJobs.enabled,
      lastRunAt: cronJobs.lastRunAt,
      createdAt: cronJobs.createdAt,
    })
    .from(cronJobs)
    .leftJoin(agents, eq(cronJobs.agentId, agents.id))
    .orderBy(desc(cronJobs.createdAt));
}

/** Toggle enabled without needing the caller to pass the agentId for auth. */
export async function setEnabledById(id: string, enabled: boolean) {
  const [updated] = await db
    .update(cronJobs)
    .set({ enabled })
    .where(eq(cronJobs.id, id))
    .returning();
  return updated ?? null;
}

export async function getAllJobs(agentId: string) {
  return db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.agentId, agentId));
}

export async function createJob(
  agentId: string,
  schedule: string,
  sessionKey: string,
  message: string,
  toolPermissions?: string[],
) {
  // Validate cron schedule before persisting
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule: "${schedule}"`);
  }

  // Block operator-level session keys
  if (BLOCKED_SESSION_KEYS.has(sessionKey)) {
    throw new Error(`Session key "${sessionKey}" is not allowed for cron jobs. Use a dedicated session key like "cron:default".`);
  }

  // Validate message is non-empty
  if (!message || message.trim().length === 0) {
    throw new Error("Cron job message must not be empty");
  }

  // Check for duplicate (same agent, schedule, sessionKey, message)
  const [existing] = await db
    .select({ id: cronJobs.id })
    .from(cronJobs)
    .where(
      and(
        eq(cronJobs.agentId, agentId),
        eq(cronJobs.schedule, schedule),
        eq(cronJobs.sessionKey, sessionKey),
        eq(cronJobs.message, message),
      ),
    )
    .limit(1);

  if (existing) {
    throw new Error(`Duplicate cron job: a job with the same schedule, session, and message already exists (id: ${existing.id})`);
  }

  const [created] = await db
    .insert(cronJobs)
    .values({
      agentId,
      schedule,
      sessionKey,
      message,
      toolPermissions: toolPermissions ?? null,
    })
    .returning();

  return created!;
}

export async function updateJobStatus(id: string, agentId: string, enabled: boolean) {
  const [updated] = await db
    .update(cronJobs)
    .set({ enabled })
    .where(and(eq(cronJobs.id, id), eq(cronJobs.agentId, agentId)))
    .returning();

  return updated ?? null;
}

export async function updateLastRun(id: string, agentId: string) {
  const now = new Date();
  const [updated] = await db
    .update(cronJobs)
    .set({ lastRunAt: now })
    .where(and(eq(cronJobs.id, id), eq(cronJobs.agentId, agentId)))
    .returning();

  return updated ?? null;
}

export async function deleteJob(id: string, agentId: string) {
  const [deleted] = await db
    .delete(cronJobs)
    .where(and(eq(cronJobs.id, id), eq(cronJobs.agentId, agentId)))
    .returning();

  return deleted ?? null;
}
