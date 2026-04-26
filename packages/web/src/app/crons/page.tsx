"use client";

import { useCallback, useEffect, useState } from "react";
import { GATEWAY_HTTP_URL } from "../../hooks/GatewayContext";

interface CronJob {
  id: string;
  agentId: string;
  agentName: string | null;
  schedule: string;
  sessionKey: string;
  message: string;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";
const TOKEN_PARAM = GATEWAY_TOKEN ? `?token=${encodeURIComponent(GATEWAY_TOKEN)}` : "";

function humanSchedule(cron: string): string {
  const m = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (m) return `every ${m[1]} min`;
  if (cron === "0 * * * *") return "hourly";
  if (cron === "0 0 * * *") return "daily at midnight";
  if (/^0 \d+ \* \* \*$/.test(cron)) {
    const hour = cron.split(" ")[1];
    return `daily at ${hour}:00`;
  }
  return cron;
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "never";
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

export default function CronsPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${GATEWAY_HTTP_URL}/crons${TOKEN_PARAM}`);
      if (!res.ok) throw new Error("Failed to fetch cron jobs");
      setJobs(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cron jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  async function handleToggle(job: CronJob) {
    setTogglingId(job.id);
    // Optimistic update
    setJobs((prev) => prev.map((j) => j.id === job.id ? { ...j, enabled: !j.enabled } : j));
    try {
      const res = await fetch(`${GATEWAY_HTTP_URL}/crons/${job.id}/status${TOKEN_PARAM}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to update");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle cron");
      fetchJobs();
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Scheduled tasks that run your agents on a timer
          </p>
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="text-xs font-medium rounded-lg px-3 py-1.5 transition-colors border disabled:opacity-40 cursor-pointer"
            style={{
              background: "var(--bg-input)",
              borderColor: "var(--border-primary)",
              color: "var(--text-secondary)",
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div
          className="rounded-lg border px-4 py-3 mb-5 text-xs"
          style={{
            background: "var(--bg-input)",
            borderColor: "var(--border-primary)",
            color: "var(--text-secondary)",
          }}
        >
          <div className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
            How to create or edit cron jobs
          </div>
          <p className="leading-relaxed">
            This page lists existing crons and lets you toggle them on/off.
            To <span className="font-medium">create, edit, or delete</span> a cron, open the Chat
            tab with the <code className="px-1 py-0.5 rounded" style={{ background: "var(--bg-active)" }}>default</code> agent
            and ask something like:
            <br />
            <span className="block mt-1.5 italic">
              &quot;Schedule the sentry-fixer agent to run every 15 minutes with the prompt &apos;check sentry&apos;&quot;
            </span>
            The default agent has a <code className="px-1 py-0.5 rounded" style={{ background: "var(--bg-active)" }}>cron_manage</code> tool
            and will set it up for you. A richer editor is planned for v1.1.
          </p>
        </div>

        {error && (
          <div
            className="rounded-lg px-4 py-3 mb-4 text-sm border"
            style={{ background: "#fef2f2", color: "#991b1b", borderColor: "#fecaca" }}
          >
            {error}
          </div>
        )}

        {loading && jobs.length === 0 ? (
          <div className="flex justify-center py-12">
            <div
              className="animate-spin w-5 h-5 border-2 rounded-full"
              style={{ borderColor: "var(--border-secondary)", borderTopColor: "var(--text-accent)" }}
            />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
            <p className="text-sm">No cron jobs yet</p>
            <p className="text-xs mt-1">Ask the default agent in Chat to create one</p>
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => {
              const isExpanded = expandedId === job.id;
              return (
                <div
                  key={job.id}
                  className="rounded-xl border px-4 py-3"
                  style={{
                    background: "var(--bg-tertiary)",
                    borderColor: "var(--border-primary)",
                    boxShadow: "var(--shadow-sm)",
                    opacity: job.enabled ? 1 : 0.6,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {job.agentName ?? "(unknown agent)"}
                        </span>
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
                          style={{
                            background: job.enabled ? "var(--bg-accent-subtle, #eef2ff)" : "var(--bg-hover)",
                            color: job.enabled ? "var(--text-accent, #4338ca)" : "var(--text-tertiary)",
                          }}
                        >
                          {humanSchedule(job.schedule)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] mb-2" style={{ color: "var(--text-tertiary)" }}>
                        <span>last run: {formatRelative(job.lastRunAt)}</span>
                        <span className="font-mono">{job.schedule}</span>
                        <span className="font-mono truncate">{job.sessionKey}</span>
                      </div>
                      {isExpanded ? (
                        <pre
                          className="text-xs whitespace-pre-wrap break-words rounded-md border px-3 py-2 max-h-64 overflow-y-auto font-mono"
                          style={{
                            color: "var(--text-secondary)",
                            background: "var(--bg-input)",
                            borderColor: "var(--border-primary)",
                          }}
                        >
                          {job.message}
                        </pre>
                      ) : (
                        <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                          {job.message.split("\n")[0]}
                        </p>
                      )}
                      {job.message.includes("\n") && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : job.id)}
                          className="text-[11px] mt-1.5 cursor-pointer hover:underline"
                          style={{ color: "var(--text-accent, #4338ca)" }}
                        >
                          {isExpanded ? "Hide prompt" : "Show full prompt"}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => handleToggle(job)}
                      disabled={togglingId === job.id}
                      className="shrink-0 inline-flex items-center h-6 w-11 rounded-full transition-colors relative disabled:opacity-50 cursor-pointer"
                      style={{ background: job.enabled ? "var(--bg-accent, #4338ca)" : "var(--bg-hover)" }}
                      aria-label={job.enabled ? "Disable" : "Enable"}
                      title={job.enabled ? "Disable cron" : "Enable cron"}
                    >
                      <span
                        className="h-5 w-5 rounded-full bg-white shadow transition-transform"
                        style={{ transform: job.enabled ? "translateX(22px)" : "translateX(2px)" }}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
