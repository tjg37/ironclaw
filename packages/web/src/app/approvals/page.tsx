"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GATEWAY_HTTP_URL } from "../../hooks/GatewayContext";

interface PendingApproval {
  id: string;
  toolName: string;
  input: unknown;
  createdAt: string;
  sessionId: string | null;
  sessionKey: string | null;
  agentName: string | null;
}

const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";
const TOKEN_PARAM = GATEWAY_TOKEN ? `?token=${encodeURIComponent(GATEWAY_TOKEN)}` : "";
const POLL_MS = 3000;

function toolDisplayName(name: string): string {
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (m) return `${m[1]!.replace("ironclaw-", "")} · ${m[2]}`;
  return name;
}

function formatRelative(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function inputPreview(input: unknown): string {
  if (input == null) return "";
  try {
    const s = typeof input === "string" ? input : JSON.stringify(input);
    return s.length > 160 ? s.slice(0, 160) + "…" : s;
  } catch {
    return String(input);
  }
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch(`${GATEWAY_HTTP_URL}/approvals${TOKEN_PARAM}`);
      if (!res.ok) throw new Error("Failed to fetch approvals");
      setItems(await res.json());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
    const id = setInterval(fetchApprovals, POLL_MS);
    return () => clearInterval(id);
  }, [fetchApprovals]);

  async function handleDecision(id: string, approve: boolean) {
    setBusyId(id);
    // Optimistic removal
    const prev = items;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const action = approve ? "approve" : "deny";
      const res = await fetch(`${GATEWAY_HTTP_URL}/approvals/${id}/${action}${TOKEN_PARAM}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to resolve");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve approval");
      setItems(prev);
    } finally {
      setBusyId(null);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Tool calls from your agents that need your approval before they run
          </p>
          <button
            onClick={fetchApprovals}
            className="text-xs font-medium rounded-lg px-3 py-1.5 transition-colors border cursor-pointer"
            style={{
              background: "var(--bg-input)",
              borderColor: "var(--border-primary)",
              color: "var(--text-secondary)",
            }}
          >
            Refresh
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
            When do approvals appear?
          </div>
          <p className="leading-relaxed">
            Agents running at the <code className="px-1 py-0.5 rounded" style={{ background: "var(--bg-active)" }}>trusted</code> or{" "}
            <code className="px-1 py-0.5 rounded" style={{ background: "var(--bg-active)" }}>untrusted</code> trust level pause here
            before using restricted tools (<code>Bash</code>, <code>Write</code>, <code>Edit</code>, <code>WebFetch</code>,{" "}
            <code>WebSearch</code>). If no one approves within 5 minutes, the call is auto-denied. Operator-level sessions bypass
            this screen. Auto-refreshes every 3s.
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

        {loading && items.length === 0 ? (
          <div className="flex justify-center py-12">
            <div
              className="animate-spin w-5 h-5 border-2 rounded-full"
              style={{ borderColor: "var(--border-secondary)", borderTopColor: "var(--text-accent)" }}
            />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
            <p className="text-sm">No pending approvals</p>
            <p className="text-xs mt-1">Tool calls that need review will show up here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const isExpanded = expanded.has(item.id);
              const preview = inputPreview(item.input);
              return (
                <div
                  key={item.id}
                  className="rounded-xl border px-4 py-3"
                  style={{
                    background: "var(--bg-tertiary)",
                    borderColor: "var(--border-primary)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                          {toolDisplayName(item.toolName)}
                        </span>
                        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                          {formatRelative(item.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] mb-2" style={{ color: "var(--text-tertiary)" }}>
                        {item.agentName && <span>agent: {item.agentName}</span>}
                        {item.sessionId && (
                          <Link
                            href={`/history?session=${item.sessionId}`}
                            className="underline underline-offset-2 hover:opacity-80"
                          >
                            view session
                          </Link>
                        )}
                      </div>
                      {isExpanded ? (
                        <pre
                          className="text-[11px] whitespace-pre-wrap break-words rounded-md border px-3 py-2 max-h-64 overflow-y-auto font-mono"
                          style={{
                            color: "var(--text-secondary)",
                            background: "var(--bg-input)",
                            borderColor: "var(--border-primary)",
                          }}
                        >
                          {typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-xs font-mono truncate" style={{ color: "var(--text-secondary)" }}>
                          {preview || "(no input)"}
                        </p>
                      )}
                      {preview && (
                        <button
                          onClick={() => toggleExpand(item.id)}
                          className="text-[11px] mt-1.5 cursor-pointer hover:underline"
                          style={{ color: "var(--text-accent, #4338ca)" }}
                        >
                          {isExpanded ? "Hide input" : "Show full input"}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => handleDecision(item.id, true)}
                        disabled={busyId === item.id}
                        className="text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer border disabled:opacity-50"
                        style={{ background: "#16a34a", borderColor: "#16a34a", color: "white" }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleDecision(item.id, false)}
                        disabled={busyId === item.id}
                        className="text-xs font-medium rounded-lg px-3 py-1.5 cursor-pointer border disabled:opacity-50"
                        style={{ background: "var(--bg-input)", borderColor: "#dc2626", color: "#dc2626" }}
                      >
                        Deny
                      </button>
                    </div>
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
