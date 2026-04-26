import { eq, and, sql } from "drizzle-orm";
import { db } from "../connection.js";
import { channelConnections } from "../schema.js";

export async function getChannelConnections(agentId: string) {
  return db
    .select()
    .from(channelConnections)
    .where(eq(channelConnections.agentId, agentId));
}

export async function getWebhookBySource(agentId: string, source: string) {
  const [row] = await db
    .select()
    .from(channelConnections)
    .where(
      and(
        eq(channelConnections.agentId, agentId),
        eq(channelConnections.channelType, "webhook"),
        sql`${channelConnections.config}->>'source' = ${source}`,
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function createChannelConnection(
  agentId: string,
  channelType: string,
  config: Record<string, unknown>,
) {
  const [created] = await db
    .insert(channelConnections)
    .values({ agentId, channelType, config })
    .returning();

  return created!;
}
