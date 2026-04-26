import { eq, asc, and, inArray, count } from "drizzle-orm";
import { db } from "../connection.js";
import { messages } from "../schema.js";

export async function appendMessage(
  sessionId: string,
  role: string,
  content: string,
  metadata?: Record<string, unknown>,
) {
  const [created] = await db
    .insert(messages)
    .values({ sessionId, role, content, metadata: metadata ?? {} })
    .returning();

  return created!;
}

export async function getSessionMessages(
  sessionId: string,
  limit?: number,
) {
  const base = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt));

  if (limit) {
    return base.limit(limit);
  }

  return base;
}

export async function deleteMessages(ids: string[], sessionId: string): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .delete(messages)
    .where(and(inArray(messages.id, ids), eq(messages.sessionId, sessionId)))
    .returning();
  return result.length;
}

export async function getSessionMessageCount(sessionId: string): Promise<number> {
  const result = await db
    .select({ value: count() })
    .from(messages)
    .where(eq(messages.sessionId, sessionId));
  return result[0]?.value ?? 0;
}
