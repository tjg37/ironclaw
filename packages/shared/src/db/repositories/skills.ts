import { eq, and } from "drizzle-orm";
import { db } from "../connection.js";
import { skills } from "../schema.js";
import type { SkillManifest, SkillRecord } from "../../types/skills.js";

function toSkillRecord(row: typeof skills.$inferSelect): SkillRecord {
  return {
    id: row.id,
    agentId: row.agentId!,
    name: row.name,
    version: row.version,
    manifest: row.manifest as SkillManifest,
    content: row.content,
    enabled: row.enabled ?? true,
    sandboxed: row.sandboxed ?? true,
  };
}

export async function getAllSkills(agentId: string): Promise<SkillRecord[]> {
  const rows = await db
    .select()
    .from(skills)
    .where(eq(skills.agentId, agentId));

  return rows.map(toSkillRecord);
}

export async function getEnabledSkills(agentId: string): Promise<SkillRecord[]> {
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.agentId, agentId), eq(skills.enabled, true)));

  return rows.map(toSkillRecord);
}

export async function getSkill(id: string, agentId: string): Promise<SkillRecord | undefined> {
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, id), eq(skills.agentId, agentId)))
    .limit(1);

  return rows[0] ? toSkillRecord(rows[0]) : undefined;
}

export async function installSkill(
  agentId: string,
  manifest: SkillManifest,
  content: string,
): Promise<SkillRecord> {
  // Check for existing skill with same (agentId, name) — update if found
  const [existing] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.agentId, agentId), eq(skills.name, manifest.name)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(skills)
      .set({
        version: manifest.version,
        manifest,
        content,
        enabled: true,
      })
      .where(eq(skills.id, existing.id))
      .returning();
    return toSkillRecord(updated!);
  }

  const [row] = await db
    .insert(skills)
    .values({
      agentId,
      name: manifest.name,
      version: manifest.version,
      manifest,
      content,
      enabled: true,
      sandboxed: true,
    })
    .returning();

  return toSkillRecord(row!);
}

export async function enableSkill(id: string, agentId: string): Promise<void> {
  await db
    .update(skills)
    .set({ enabled: true })
    .where(and(eq(skills.id, id), eq(skills.agentId, agentId)));
}

export async function disableSkill(id: string, agentId: string): Promise<void> {
  await db
    .update(skills)
    .set({ enabled: false })
    .where(and(eq(skills.id, id), eq(skills.agentId, agentId)));
}
