import { randomUUID } from "node:crypto";
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { StringCodec } from "nats";
import type { NatsConnection } from "nats";
import { cronJobsRepo, agentRepo, NATS_SUBJECTS } from "@ironclaw/shared";
import type { InboundMessage } from "@ironclaw/shared";

const sc = StringCodec();

let nc: NatsConnection | null = null;
const scheduledTasks: Map<string, ScheduledTask> = new Map();
// Cache agent name per agentId to avoid a DB lookup on every cron fire.
const agentNameById = new Map<string, string>();

export async function startScheduler(
  natsConn: NatsConnection,
  _agentId?: string, // kept for backward compatibility; scheduler loads all agents' jobs
): Promise<void> {
  nc = natsConn;
  await loadAndScheduleJobs();
  console.log("[scheduler] Started");
}

export function stopScheduler(): void {
  for (const [id, task] of scheduledTasks) {
    task.stop();
    console.log(`[scheduler] Stopped job ${id}`);
  }
  scheduledTasks.clear();
  console.log("[scheduler] Stopped");
}

export async function reloadJobs(): Promise<void> {
  stopScheduler();
  await loadAndScheduleJobs();
  console.log("[scheduler] Reloaded jobs");
}

async function loadAndScheduleJobs(): Promise<void> {
  if (!nc) return;

  const jobs = await cronJobsRepo.getAllEnabledJobs();
  console.log(`[scheduler] Loading ${jobs.length} enabled job(s)`);

  for (const job of jobs) {
    if (!cron.validate(job.schedule)) {
      console.warn(`[scheduler] Invalid cron schedule for job ${job.id}: ${job.schedule}`);
      continue;
    }

    if (!job.agentId) {
      console.warn(`[scheduler] Skipping job ${job.id}: missing agentId`);
      continue;
    }

    // Cron jobs always run with "untrusted" trust level — they should never
    // have operator access. The session key determines isolation but not privilege.
    if (job.sessionKey === "main") {
      console.warn(`[scheduler] Skipping job ${job.id}: "main" session key is not allowed for cron jobs`);
      continue;
    }

    // Resolve agent name once so each fire can route the message correctly.
    let agentName = agentNameById.get(job.agentId);
    if (!agentName) {
      const agent = await agentRepo.getAgentById(job.agentId);
      if (!agent) {
        console.warn(`[scheduler] Skipping job ${job.id}: agent ${job.agentId} not found`);
        continue;
      }
      agentName = agent.name;
      agentNameById.set(job.agentId, agentName);
    }

    const jobAgentId = job.agentId;
    const resolvedName = agentName;
    const task = cron.schedule(job.schedule, () => {
      void fireJob(job.id, jobAgentId, resolvedName, job.sessionKey, job.message);
    });

    scheduledTasks.set(job.id, task);
    console.log(`[scheduler] Scheduled job ${job.id}: "${job.schedule}" → ${resolvedName} (${job.sessionKey})`);
  }
}

/**
 * Produce a per-fire sessionKey so each cron run lives in its own session
 * (prevents prior-context bleed between runs, gives /history one row per fire).
 * Exported for tests.
 */
export function buildCronFireSessionKey(baseSessionKey: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${baseSessionKey}:${stamp}`;
}

async function fireJob(
  jobId: string,
  jobAgentId: string,
  agentName: string,
  baseSessionKey: string,
  message: string,
): Promise<void> {
  if (!nc) {
    console.error("[scheduler] NATS not connected, skipping job", jobId);
    return;
  }

  // Each fire gets its own session so /history lists runs separately
  // and prior-context loading never leaks between runs.
  const sessionKey = buildCronFireSessionKey(baseSessionKey);

  console.log(`[scheduler] Firing job ${jobId} → ${agentName} (${sessionKey})`);

  const inbound: InboundMessage = {
    id: randomUUID(),
    sessionKey,
    channel: "cron",
    senderId: "scheduler",
    content: message,
    agentName,
    metadata: {
      cronJobId: jobId,
      // Explicitly mark trust level so the worker can enforce it
      // instead of inferring from session key
      trustLevel: "untrusted",
    },
  };

  nc.publish(NATS_SUBJECTS.INBOUND, sc.encode(JSON.stringify(inbound)));

  try {
    await cronJobsRepo.updateLastRun(jobId, jobAgentId);
  } catch (err) {
    console.error(`[scheduler] Failed to update last_run_at for job ${jobId}:`, err);
  }
}
