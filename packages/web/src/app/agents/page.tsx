"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GATEWAY_HTTP_URL, useGateway } from "../../hooks/GatewayContext";

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  general: "General-purpose assistant, good at everything",
  developer: "Code, debugging, architecture, and technical explanations",
  research: "Thorough information gathering, citations, and analysis",
  organizer: "Task tracking, scheduling, reminders, and organization",
  writer: "Content creation, editing, copywriting, and communication",
  data_analyst: "Data exploration, SQL queries, visualizations, and insights",
  devops: "Infrastructure, deployment, monitoring, and incident response",
  product_manager: "Requirements, specifications, user stories, and prioritization",
};

interface AgentDetail {
  name: string;
  persona: string;
  customPersona?: string | null;
  model?: string;
  boundaries?: {
    allowBash?: boolean;
    allowFileWrites?: boolean;
    allowWebSearch?: boolean;
    allowSystemFiles?: boolean;
  };
  allowedAgents?: string[];
}

const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";
const TOKEN_PARAM = GATEWAY_TOKEN ? `?token=${encodeURIComponent(GATEWAY_TOKEN)}` : "";

const MODELS = [
  { value: "default", label: "Default (Sonnet)" },
  { value: "claude-opus-4-20250514", label: "Opus 4 (most capable)" },
  { value: "claude-sonnet-4-20250514", label: "Sonnet 4 (balanced)" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (fastest)" },
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { agentName, setAgentName, clearMessages } = useGateway();
  const router = useRouter();

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${GATEWAY_HTTP_URL}/agents${TOKEN_PARAM}`);
      if (!res.ok) throw new Error("Failed to fetch agents");
      setAgents(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  function handleChatWith(name: string) {
    setAgentName(name);
    clearMessages();
    router.push("/chat");
  }

  async function handleUpdateAgent(name: string, updates: Partial<AgentDetail>) {
    try {
      const res = await fetch(`${GATEWAY_HTTP_URL}/agents/${encodeURIComponent(name)}${TOKEN_PARAM}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to update");
      }
      // Update local state optimistically
      setAgents((prev) =>
        prev.map((a) => a.name === name ? { ...a, ...updates } : a),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent");
      // Re-fetch to reset state
      fetchAgents();
    }
  }

  const allAgentNames = agents.map((a) => a.name);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Manage your AI agents and their configurations
          </p>
          <button
            onClick={fetchAgents}
            disabled={loading}
            className="text-xs font-medium rounded-lg px-3 py-1.5 transition-colors border cursor-pointer flex items-center gap-1.5"
            style={{
              background: "var(--bg-input)",
              borderColor: "var(--border-primary)",
              color: "var(--text-secondary)",
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-input)"; }}
          >
            {loading && (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div
            className="rounded-lg px-4 py-3 mb-4 text-sm border animate-fade-in"
            style={{ background: "#fef2f2", color: "#991b1b", borderColor: "#fecaca" }}
          >
            {error}
            <button onClick={() => setError("")} className="ml-2 underline text-xs">dismiss</button>
          </div>
        )}

        {loading && agents.length === 0 ? (
          <div className="flex justify-center py-12">
            <div
              className="animate-spin w-5 h-5 border-2 rounded-full"
              style={{ borderColor: "var(--border-secondary)", borderTopColor: "var(--text-accent)" }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                isActive={agent.name === agentName}
                allAgentNames={allAgentNames}
                onChatWith={() => handleChatWith(agent.name)}
                onUpdate={(updates) => handleUpdateAgent(agent.name, updates)}
              />
            ))}
            {agents.length === 0 && !loading && (
              <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
                <p className="text-sm">No agents found</p>
                <p className="text-xs mt-1">Create agents using the CLI or chat</p>
              </div>
            )}
          </div>
        )}

        <div
          className="mt-8 rounded-lg border px-4 py-3"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border-primary)" }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
            Managing agents
          </p>
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            Create and delete agents using Claude Code (<code className="font-mono">/add-agent</code>) or by asking the running agent in chat. Boundaries, model, and delegation can be edited directly above.
          </p>
        </div>
      </div>
    </div>
  );
}

const BOUNDARY_CONFIG = [
  { key: "allowBash" as const, label: "Bash", description: "Run shell commands" },
  { key: "allowFileWrites" as const, label: "File writes", description: "Create and edit files" },
  { key: "allowWebSearch" as const, label: "Web search", description: "Search the internet" },
  { key: "allowSystemFiles" as const, label: "System files", description: "Access files outside project" },
];

function AgentCard({
  agent,
  isActive,
  allAgentNames,
  onChatWith,
  onUpdate,
}: {
  agent: AgentDetail;
  isActive: boolean;
  allAgentNames: string[];
  onChatWith: () => void;
  onUpdate: (updates: Partial<AgentDetail>) => void;
}) {
  const boundaries = agent.boundaries ?? {};
  const otherAgents = allAgentNames.filter((n) => n !== agent.name);

  function toggleBoundary(key: keyof NonNullable<AgentDetail["boundaries"]>) {
    const current = boundaries[key] ?? false;
    onUpdate({ boundaries: { ...boundaries, [key]: !current } });
  }

  function toggleDelegation(targetName: string) {
    const current = agent.allowedAgents ?? [];
    const updated = current.includes(targetName)
      ? current.filter((n) => n !== targetName)
      : [...current, targetName];
    onUpdate({ allowedAgents: updated });
  }

  function changeModel(model: string) {
    if (model === "default") {
      // Remove model override — use env default
      onUpdate({ model: "__default__" });
    } else {
      onUpdate({ model });
    }
  }

  return (
    <div
      className="rounded-xl border px-5 py-4 transition-all"
      style={{
        background: "var(--bg-tertiary)",
        borderColor: isActive ? "var(--border-focus)" : "var(--border-primary)",
        boxShadow: isActive ? "0 0 0 1px var(--border-focus)" : "var(--shadow-sm)",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
            style={{ background: "var(--bg-accent)", color: "var(--text-inverse)" }}
          >
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {agent.name}
              </h3>
              {isActive && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ background: "var(--status-connected)", color: "white" }}
                >
                  Active
                </span>
              )}
            </div>
            <p className="text-xs capitalize" style={{ color: "var(--text-tertiary)" }}>
              {agent.persona} agent
            </p>
          </div>
        </div>
        <button
          onClick={onChatWith}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
          style={{
            background: isActive ? "var(--bg-secondary)" : "var(--bg-accent)",
            color: isActive ? "var(--text-secondary)" : "var(--text-inverse)",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = isActive ? "var(--bg-hover)" : "var(--bg-accent-hover)"}
          onMouseLeave={(e) => e.currentTarget.style.background = isActive ? "var(--bg-secondary)" : "var(--bg-accent)"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          {isActive ? "Chatting" : "Chat"}
        </button>
      </div>

      {/* Description */}
      <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
        {agent.customPersona ?? PERSONA_DESCRIPTIONS[agent.persona] ?? "AI assistant"}
      </p>

      {/* Model selector */}
      <div className="mb-3">
        <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>
          Model
        </label>
        <select
          value={agent.model === "default" || !agent.model ? "default" : agent.model}
          onChange={(e) => changeModel(e.target.value)}
          className="w-full rounded-lg px-3 py-1.5 text-xs font-mono cursor-pointer focus:outline-none focus:ring-2 border"
          style={{
            background: "var(--bg-input)",
            borderColor: "var(--border-primary)",
            color: "var(--text-primary)",
            "--tw-ring-color": "var(--border-focus)",
          } as React.CSSProperties}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Boundary toggles */}
      <div className="mb-3">
        <label className="text-[11px] font-medium uppercase tracking-wider mb-1.5 block" style={{ color: "var(--text-tertiary)" }}>
          Capabilities
        </label>
        <div className="grid grid-cols-2 gap-2">
          {BOUNDARY_CONFIG.map(({ key, label, description }) => {
            const enabled = boundaries[key] === true;
            return (
              <button
                key={key}
                onClick={() => toggleBoundary(key)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer border"
                style={{
                  background: enabled ? "var(--bg-secondary)" : "var(--bg-primary)",
                  borderColor: enabled ? "var(--border-secondary)" : "var(--border-primary)",
                }}
              >
                <div
                  className="w-8 h-4.5 rounded-full relative shrink-0 transition-colors"
                  style={{ background: enabled ? "var(--status-connected)" : "var(--border-secondary)" }}
                >
                  <div
                    className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all"
                    style={{ left: enabled ? "calc(100% - 1rem)" : "2px" }}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{label}</p>
                  <p className="text-[10px] truncate" style={{ color: "var(--text-tertiary)" }}>{description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Delegation */}
      <div className="pt-3 border-t" style={{ borderColor: "var(--border-primary)" }}>
        <label className="text-[11px] font-medium uppercase tracking-wider mb-1.5 block" style={{ color: "var(--text-tertiary)" }}>
          Can delegate to
        </label>
        {otherAgents.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {otherAgents.map((name) => {
              const isAllowed = (agent.allowedAgents ?? []).includes(name);
              return (
                <button
                  key={name}
                  onClick={() => toggleDelegation(name)}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors cursor-pointer border"
                  style={{
                    background: isAllowed ? "var(--bg-accent)" : "var(--bg-primary)",
                    color: isAllowed ? "var(--text-inverse)" : "var(--text-secondary)",
                    borderColor: isAllowed ? "var(--bg-accent)" : "var(--border-primary)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isAllowed) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isAllowed) e.currentTarget.style.background = "var(--bg-primary)";
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>No other agents available</p>
        )}
      </div>
    </div>
  );
}
