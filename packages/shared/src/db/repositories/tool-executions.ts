import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../connection.js";
import { toolExecutions, sessions, agents } from "../schema.js";

export async function getSessionToolExecutions(sessionId: string) {
  return db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.sessionId, sessionId))
    .orderBy(asc(toolExecutions.createdAt));
}

export async function logToolExecution(params: {
  sessionId: string;
  toolName: string;
  permissionsUsed: string[];
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: string;
  approvalRequired: boolean;
  durationMs: number | null;
}) {
  const [created] = await db
    .insert(toolExecutions)
    .values({
      sessionId: params.sessionId,
      toolName: params.toolName,
      permissionsUsed: params.permissionsUsed,
      input: params.input,
      output: params.output,
      status: params.status,
      approvalRequired: params.approvalRequired,
      executedAt: params.status === "executed" ? new Date() : null,
      durationMs: params.durationMs,
    })
    .returning();

  return created!;
}

/** Create a row in 'pending' state so the approval hook can block on it. */
export async function createPendingApproval(params: {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
}) {
  const [created] = await db
    .insert(toolExecutions)
    .values({
      sessionId: params.sessionId,
      toolName: params.toolName,
      permissionsUsed: [],
      input: params.input,
      output: null,
      status: "pending",
      approvalRequired: true,
      durationMs: null,
    })
    .returning();
  return created!;
}

/** Poll a pending row until its status leaves 'pending' or we hit the timeout. */
export async function waitForApprovalResolution(
  id: string,
  timeoutMs: number,
  pollMs = 2000,
): Promise<"approved" | "denied" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.select({ status: toolExecutions.status }).from(toolExecutions).where(eq(toolExecutions.id, id));
    if (!row) return "denied"; // row gone, treat as denied
    if (row.status === "approved") return "approved";
    if (row.status === "denied") return "denied";
    await new Promise((r) => setTimeout(r, pollMs));
  }
  // Timed out — mark as denied so the queue doesn't keep showing it.
  await db
    .update(toolExecutions)
    .set({ status: "denied", approvedAt: new Date() })
    .where(and(eq(toolExecutions.id, id), eq(toolExecutions.status, "pending")));
  return "timeout";
}

/** Set the row's status; returns the updated row or null if not in 'pending' state. */
export async function resolveApproval(id: string, approved: boolean) {
  const [updated] = await db
    .update(toolExecutions)
    .set({
      status: approved ? "approved" : "denied",
      approvedAt: new Date(),
    })
    .where(and(eq(toolExecutions.id, id), eq(toolExecutions.status, "pending")))
    .returning();
  return updated ?? null;
}

/** List every pending approval across all agents, with session + agent context for the UI. */
export async function listPendingApprovals() {
  return db
    .select({
      id: toolExecutions.id,
      toolName: toolExecutions.toolName,
      input: toolExecutions.input,
      createdAt: toolExecutions.createdAt,
      sessionId: toolExecutions.sessionId,
      sessionKey: sessions.sessionKey,
      agentName: agents.name,
    })
    .from(toolExecutions)
    .leftJoin(sessions, eq(toolExecutions.sessionId, sessions.id))
    .leftJoin(agents, eq(sessions.agentId, agents.id))
    .where(eq(toolExecutions.status, "pending"))
    .orderBy(desc(toolExecutions.createdAt));
}
