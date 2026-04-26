import { eq, and, desc, sql, lt } from "drizzle-orm";
import { db } from "../connection.js";
import { sessions, agents } from "../schema.js";

export async function findOrCreateSession(
  agentId: string,
  sessionKey: string,
  trustLevel = "operator",
) {
  const existing = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.agentId, agentId), eq(sessions.sessionKey, sessionKey)))
    .limit(1);

  if (existing.length > 0) {
    return existing[0]!;
  }

  const [created] = await db
    .insert(sessions)
    .values({ agentId, sessionKey, trustLevel })
    .returning();

  return created!;
}

export async function getSession(sessionId: string) {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * List sessions for a tenant's agents, with message count and first message preview.
 * Excludes delegation sessions (agent:*) by default.
 */
export async function listSessions(tenantId: string, options?: {
  limit?: number;
  cursor?: string; // ISO date string — fetch sessions updated before this time
  includeDelegation?: boolean;
  sessionType?: "all" | "chat" | "cron";
  status?: "all" | "success" | "error" | "incomplete";
  agentName?: string;
  search?: string;
}) {
  const limit = options?.limit ?? 20;

  const conditions = [eq(agents.tenantId, tenantId)];
  if (!options?.includeDelegation) {
    conditions.push(sql`${sessions.sessionKey} NOT LIKE 'agent:%'`);
  }
  if (options?.cursor) {
    const cursorDate = new Date(options.cursor);
    if (isNaN(cursorDate.getTime())) {
      return { sessions: [], hasMore: false, nextCursor: null };
    }
    conditions.push(lt(sessions.updatedAt, cursorDate));
  }
  if (options?.sessionType === "cron") {
    conditions.push(sql`${sessions.sessionKey} LIKE 'cron:%'`);
  } else if (options?.sessionType === "chat") {
    conditions.push(sql`${sessions.sessionKey} NOT LIKE 'cron:%'`);
  }
  if (options?.agentName) {
    conditions.push(eq(agents.name, options.agentName));
  }
  if (options?.search && options.search.trim()) {
    const pattern = `%${options.search.trim()}%`;
    conditions.push(sql`(
      ${agents.name} ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM messages m
        WHERE m.session_id = ${sessions.id}
        AND m.content ILIKE ${pattern}
      )
    )`);
  }
  if (options?.status && options.status !== "all") {
    if (options.status === "error") {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM tool_executions te
        WHERE te.session_id = ${sessions.id} AND te.status = 'failed'
      )`);
    } else if (options.status === "incomplete") {
      conditions.push(sql`
        NOT EXISTS (
          SELECT 1 FROM tool_executions te
          WHERE te.session_id = ${sessions.id} AND te.status = 'failed'
        )
        AND EXISTS (
          SELECT 1 FROM messages m WHERE m.session_id = ${sessions.id}
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.session_id = ${sessions.id}
          AND m.role = 'assistant'
          AND m.content IS NOT NULL
          AND btrim(m.content) <> ''
        )
      `);
    } else if (options.status === "success") {
      conditions.push(sql`
        NOT EXISTS (
          SELECT 1 FROM tool_executions te
          WHERE te.session_id = ${sessions.id} AND te.status = 'failed'
        )
        AND EXISTS (
          SELECT 1 FROM messages m
          WHERE m.session_id = ${sessions.id}
          AND m.role = 'assistant'
          AND m.content IS NOT NULL
          AND btrim(m.content) <> ''
        )
      `);
    }
  }

  const rows = await db
    .select({
      id: sessions.id,
      sessionKey: sessions.sessionKey,
      trustLevel: sessions.trustLevel,
      agentId: sessions.agentId,
      agentName: agents.name,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      messageCount: sql<number>`(
        SELECT count(*)::int FROM messages
        WHERE messages.session_id = ${sessions.id}
      )`,
      firstMessage: sql<string>`(
        SELECT content FROM messages
        WHERE messages.session_id = ${sessions.id}
        AND messages.role = 'user'
        ORDER BY messages.created_at ASC
        LIMIT 1
      )`,
      lastMessage: sql<string>`(
        SELECT content FROM messages
        WHERE messages.session_id = ${sessions.id}
        ORDER BY messages.created_at DESC
        LIMIT 1
      )`,
      lastAssistantContent: sql<string | null>`(
        SELECT content FROM messages
        WHERE messages.session_id = ${sessions.id}
        AND messages.role = 'assistant'
        ORDER BY messages.created_at DESC
        LIMIT 1
      )`,
      toolCallCount: sql<number>`(
        SELECT count(*)::int FROM tool_executions
        WHERE tool_executions.session_id = ${sessions.id}
      )`,
      failedToolCount: sql<number>`(
        SELECT count(*)::int FROM tool_executions
        WHERE tool_executions.session_id = ${sessions.id}
        AND tool_executions.status = 'failed'
      )`,
    })
    .from(sessions)
    .innerJoin(agents, eq(sessions.agentId, agents.id))
    .where(and(...conditions))
    .orderBy(desc(sessions.updatedAt))
    .limit(limit + 1); // fetch one extra to determine if there are more

  const hasMore = rows.length > limit;
  const filtered = hasMore ? rows.slice(0, limit) : rows;

  const nextCursor = hasMore && filtered.length > 0
    ? filtered[filtered.length - 1]!.updatedAt?.toISOString() ?? null
    : null;

  return { sessions: filtered, hasMore, nextCursor };
}

export async function updateSessionTimestamp(sessionId: string) {
  await db
    .update(sessions)
    .set({ updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}
