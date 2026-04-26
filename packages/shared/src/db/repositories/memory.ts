import { eq, and, or, ilike, sql, desc } from "drizzle-orm";
import { db } from "../connection.js";
import { memoryEntries } from "../schema.js";
import { generateEmbedding } from "../../embeddings.js";

export interface MemoryEntry {
  id: string;
  agentId: string;
  content: string;
  source: string | null;
  sourceSessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date | null;
  score?: number;
}

/**
 * Store a memory entry with an embedding vector.
 * Agent ID is mandatory to enforce per-agent isolation.
 */
export async function storeMemory(params: {
  agentId: string;
  content: string;
  source?: string;
  sourceSessionId?: string;
  metadata?: Record<string, unknown>;
}): Promise<MemoryEntry> {
  const embedding = await generateEmbedding(params.content);

  const [created] = await db
    .insert(memoryEntries)
    .values({
      agentId: params.agentId,
      content: params.content,
      embedding,
      source: params.source ?? "conversation",
      sourceSessionId: params.sourceSessionId,
      metadata: params.metadata ?? {},
    })
    .returning();

  return {
    id: created!.id,
    agentId: created!.agentId!,
    content: created!.content,
    source: created!.source,
    sourceSessionId: created!.sourceSessionId,
    metadata: created!.metadata as Record<string, unknown>,
    createdAt: created!.createdAt,
  };
}

/**
 * Hybrid search: vector cosine similarity + keyword matching.
 * Two separate queries, merged and re-ranked in TypeScript.
 * Agent ID is mandatory for isolation.
 */
export async function searchMemory(params: {
  agentId: string;
  query: string;
  limit?: number;
  sourceSessionId?: string;
}): Promise<MemoryEntry[]> {
  const limit = params.limit ?? 10;

  // Query 1: Vector cosine similarity
  const queryEmbedding = await generateEmbedding(params.query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const sessionFilter = params.sourceSessionId
    ? sql`AND source_session_id = ${params.sourceSessionId}`
    : sql``;

  const vectorResults = await db.execute<{
    id: string;
    agent_id: string;
    content: string;
    source: string | null;
    source_session_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    similarity: number;
  }>(sql`
    SELECT id, agent_id, content, source, source_session_id, metadata, created_at,
           1 - (embedding <=> ${embeddingStr}::vector) as similarity
    FROM memory_entries
    WHERE agent_id = ${params.agentId}
      AND embedding IS NOT NULL
      ${sessionFilter}
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);

  // Query 2: Keyword matching (simple ILIKE with word splitting)
  const keywords = params.query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2); // skip short words

  let keywordResults: Array<{
    id: string;
    agent_id: string;
    content: string;
    source: string | null;
    source_session_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    similarity: number;
  }> = [];
  if (keywords.length > 0) {
    const keywordConditions = or(
      ...keywords.map((k) => {
        // Escape ILIKE wildcards to prevent unintended pattern matching
        const escaped = k.replace(/[%_]/g, "\\$&");
        return ilike(memoryEntries.content, `%${escaped}%`);
      }),
    );

    keywordResults = await db.execute<{
      id: string;
      agent_id: string;
      content: string;
      source: string | null;
      source_session_id: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
      similarity: number;
    }>(sql`
      SELECT id, agent_id, content, source, source_session_id, metadata, created_at,
             0.5 as similarity
      FROM memory_entries
      WHERE agent_id = ${params.agentId}
        AND ${keywordConditions}
        ${sessionFilter}
      LIMIT ${limit}
    `);
  }

  // Merge: combine results, deduplicate by id, take the higher score
  const merged = new Map<string, MemoryEntry & { score: number }>();

  for (const row of vectorResults) {
    merged.set(row.id, {
      id: row.id,
      agentId: row.agent_id,
      content: row.content,
      source: row.source,
      sourceSessionId: row.source_session_id,
      metadata: row.metadata ?? {},
      createdAt: row.created_at ? new Date(row.created_at) : null,
      score: row.similarity,
    });
  }

  for (const row of keywordResults) {
    const existing = merged.get(row.id);
    if (existing) {
      // Boost score if found in both vector and keyword results
      existing.score = Math.min(1, existing.score + 0.15);
    } else {
      merged.set(row.id, {
        id: row.id,
        agentId: row.agent_id,
        content: row.content,
        source: row.source,
        sourceSessionId: row.source_session_id,
        metadata: row.metadata ?? {},
        createdAt: row.created_at ? new Date(row.created_at) : null,
        score: 0.5,
      });
    }
  }

  // Sort by score descending, take top N
  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get recent memories for an agent (no embedding required).
 */
export async function getRecentMemories(
  agentId: string,
  limit = 20,
): Promise<MemoryEntry[]> {
  const rows = await db
    .select()
    .from(memoryEntries)
    .where(eq(memoryEntries.agentId, agentId))
    .orderBy(desc(memoryEntries.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agentId!,
    content: r.content,
    source: r.source,
    sourceSessionId: r.sourceSessionId,
    metadata: r.metadata as Record<string, unknown>,
    createdAt: r.createdAt,
  }));
}

/**
 * Delete a memory entry. Agent ID required for isolation.
 */
export async function deleteMemory(id: string, agentId: string): Promise<boolean> {
  const result = await db
    .delete(memoryEntries)
    .where(and(eq(memoryEntries.id, id), eq(memoryEntries.agentId, agentId)))
    .returning();

  return result.length > 0;
}
