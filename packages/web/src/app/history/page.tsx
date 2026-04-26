"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import { REMARK_PLUGINS, MARKDOWN_COMPONENTS, normalizeMarkdown } from "../../lib/markdown";
import { GATEWAY_HTTP_URL } from "../../hooks/GatewayContext";

interface SessionSummary {
  id: string;
  sessionKey: string;
  trustLevel: string;
  agentId: string;
  agentName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  firstMessage: string | null;
  lastMessage: string | null;
  lastAssistantContent: string | null;
  toolCallCount: number;
  failedToolCount: number;
}

type RunStatus = "success" | "error" | "incomplete";

function deriveStatus(s: SessionSummary): RunStatus {
  if (s.failedToolCount > 0) return "error";
  // Session did something but ended without a text reply from the assistant.
  if (s.messageCount > 0 && (!s.lastAssistantContent || !s.lastAssistantContent.trim())) {
    return "incomplete";
  }
  return "success";
}

function StatusDot({ status }: { status: RunStatus }) {
  const color = status === "error" ? "#dc2626" : status === "incomplete" ? "#d97706" : "#16a34a";
  const label = status === "error" ? "Error" : status === "incomplete" ? "Incomplete" : "Success";
  return (
    <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

interface MessageEvent {
  kind: "message";
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface ToolCallEvent {
  kind: "tool_call";
  id: string;
  toolName: string;
  status: string;
  input: unknown;
  output: unknown;
  durationMs: number | null;
  createdAt: string;
}

type TimelineEvent = MessageEvent | ToolCallEvent;

function toolDisplayName(name: string): string {
  // mcp__server__tool → server · tool; Bash → Bash
  const mcpMatch = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (mcpMatch) {
    const [, server, tool] = mcpMatch;
    return `${server!.replace("ironclaw-", "")} · ${tool}`;
  }
  return name;
}

function toolOutputText(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function ToolCallRow({ event }: { event: ToolCallEvent }) {
  const [expanded, setExpanded] = useState(false);
  const outText = toolOutputText(event.output);
  // Match real failure markers at the start of the output or in explicit error fields.
  // Substring matches like "error" in a PR title ("Improve error filtering") produced
  // false positives — require a structural signal.
  const isError = event.status === "failed"
    || /^\s*"?error"?\s*[:"]|"success":false|exceeds maximum allowed tokens/i.test(outText.slice(0, 300));
  const duration = event.durationMs != null ? `${(event.durationMs / 1000).toFixed(1)}s` : null;

  return (
    <div
      className="rounded-md border text-[11px] font-mono"
      style={{
        background: isError ? "rgb(254 242 242 / 0.5)" : "var(--bg-input)",
        borderColor: isError ? "rgb(248 113 113 / 0.4)" : "var(--border-primary)",
      }}
    >
      <button
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left cursor-pointer"
        style={{ color: isError ? "rgb(153 27 27)" : "var(--text-secondary)" }}
      >
        <span className="text-[9px] opacity-60">{expanded ? "▾" : "▸"}</span>
        <span className="truncate flex-1">{toolDisplayName(event.toolName)}</span>
        {duration && <span className="opacity-60 text-[10px]">{duration}</span>}
        {isError && <span className="text-[9px] uppercase font-semibold">err</span>}
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          {event.input != null && (
            <div>
              <div className="text-[9px] uppercase opacity-60 mb-0.5">input</div>
              <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug opacity-90">
                {toolOutputText(event.input).slice(0, 2000)}
              </pre>
            </div>
          )}
          {outText && (
            <div>
              <div className="text-[9px] uppercase opacity-60 mb-0.5">output</div>
              <pre className="whitespace-pre-wrap break-all text-[10px] leading-snug opacity-90">
                {outText.slice(0, 2000)}{outText.length > 2000 ? "\n…[truncated]" : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";
const TOKEN_PARAM = GATEWAY_TOKEN ? `?token=${encodeURIComponent(GATEWAY_TOKEN)}` : "";

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "chat" | "cron">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RunStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce the search so each keystroke doesn't hit the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Derive unique agent names for filter dropdown
  const agentNames = useMemo(() => {
    const names = new Set(sessions.map((s) => s.agentName));
    return Array.from(names).sort();
  }, [sessions]);

  // Filters now run on the server via query params; sessions already contains the filtered slice.
  const filteredSessions = sessions;

  // Build the query string with active filters so the server returns the right slice.
  const buildSessionsUrl = useCallback((cursor?: string) => {
    const params = new URLSearchParams();
    if (GATEWAY_TOKEN) params.set("token", GATEWAY_TOKEN);
    if (cursor) params.set("cursor", cursor);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (typeFilter === "cron" && statusFilter !== "all") params.set("status", statusFilter);
    if (agentFilter !== "all") params.set("agent", agentFilter);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    const qs = params.toString();
    return `${GATEWAY_HTTP_URL}/sessions${qs ? `?${qs}` : ""}`;
  }, [typeFilter, statusFilter, agentFilter, debouncedSearch]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(buildSessionsUrl());
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const data = await res.json();
      setSessions(data.sessions ?? data);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [buildSessionsUrl]);

  async function loadMoreSessions() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildSessionsUrl(nextCursor));
      if (!res.ok) throw new Error("Failed to load more");
      const data = await res.json();
      setSessions((prev) => [...prev, ...(data.sessions ?? [])]);
      setHasMore(data.hasMore ?? false);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more sessions");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  async function loadMessages(sessionId: string) {
    if (selectedSession === sessionId) {
      setSelectedSession(null);
      setEvents([]);
      return;
    }
    setSelectedSession(sessionId);
    setMessagesLoading(true);
    try {
      const res = await fetch(`${GATEWAY_HTTP_URL}/sessions/${sessionId}/events${TOKEN_PARAM}`);
      if (!res.ok) throw new Error("Failed to fetch events");
      setEvents(await res.json());
    } catch {
      setEvents([]);
    } finally {
      setMessagesLoading(false);
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHour / 24);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }

  function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function truncate(text: string | null, maxLen: number): string {
    if (!text) return "No messages";
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Browse past conversations
          </p>
          <button
            onClick={fetchSessions}
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

        {/* Type / status filter chips */}
        {sessions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {(["all", "chat", "cron"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTypeFilter(t);
                  if (t !== "cron") setStatusFilter("all");
                }}
                className="text-xs font-medium rounded-full px-3 py-1 border cursor-pointer transition-colors"
                style={{
                  background: typeFilter === t ? "var(--bg-active)" : "var(--bg-input)",
                  borderColor: typeFilter === t ? "var(--border-focus)" : "var(--border-primary)",
                  color: typeFilter === t ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {t === "all" ? "All" : t === "chat" ? "Conversations" : "Cron runs"}
              </button>
            ))}
            {typeFilter === "cron" && (
              <>
                <span className="mx-1 text-[10px]" style={{ color: "var(--text-tertiary)" }}>·</span>
                {(["all", "success", "error", "incomplete"] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className="text-xs font-medium rounded-full px-3 py-1 border cursor-pointer transition-colors"
                    style={{
                      background: statusFilter === st ? "var(--bg-active)" : "var(--bg-input)",
                      borderColor: statusFilter === st ? "var(--border-focus)" : "var(--border-primary)",
                      color: statusFilter === st ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {st === "all" ? "Any status" : st[0]!.toUpperCase() + st.slice(1)}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Search and filter */}
        {sessions.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1 relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                style={{ color: "var(--text-tertiary)" }}
              >
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-2 border"
                style={{
                  background: "var(--bg-input)",
                  borderColor: "var(--border-primary)",
                  color: "var(--text-primary)",
                  "--tw-ring-color": "var(--border-focus)",
                } as React.CSSProperties}
              />
            </div>
            {agentNames.length > 1 && (
              <div className="relative">
                <select
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  className="appearance-none rounded-lg pl-3 pr-8 py-2 text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 border"
                  style={{
                    background: "var(--bg-input)",
                    borderColor: "var(--border-primary)",
                    color: "var(--text-primary)",
                    "--tw-ring-color": "var(--border-focus)",
                  } as React.CSSProperties}
                >
                  <option value="all">All agents</option>
                  {agentNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <svg
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            className="rounded-lg px-4 py-3 mb-4 text-sm border"
            style={{ background: "#fef2f2", color: "#991b1b", borderColor: "#fecaca" }}
          >
            {error}
          </div>
        )}

        {loading && sessions.length === 0 ? (
          <div className="flex justify-center py-12">
            <div
              className="animate-spin w-5 h-5 border-2 rounded-full"
              style={{ borderColor: "var(--border-secondary)", borderTopColor: "var(--text-accent)" }}
            />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
            <p className="text-sm">No conversation history</p>
            <p className="text-xs mt-1">Start chatting to see sessions here</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-center py-12" style={{ color: "var(--text-tertiary)" }}>
            <p className="text-sm">No matching conversations</p>
            <p className="text-xs mt-1">
              {searchQuery ? `No results for "${searchQuery}"` : "Try a different filter"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSessions.map((session) => (
              <div key={session.id}>
                {/* Session card */}
                <button
                  onClick={() => loadMessages(session.id)}
                  className="w-full text-left rounded-xl border px-4 py-3 transition-all cursor-pointer"
                  style={{
                    background: selectedSession === session.id ? "var(--bg-secondary)" : "var(--bg-tertiary)",
                    borderColor: selectedSession === session.id ? "var(--border-focus)" : "var(--border-primary)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                  onMouseEnter={(e) => {
                    if (selectedSession !== session.id) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (selectedSession !== session.id) e.currentTarget.style.background = "var(--bg-tertiary)";
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                          {truncate(session.firstMessage, 60)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        <span className="flex items-center gap-1">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
                          </svg>
                          {session.agentName}
                        </span>
                        {session.sessionKey.startsWith("cron:") && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
                            style={{ background: "var(--bg-accent-subtle, #eef2ff)", color: "var(--text-accent, #4338ca)" }}
                          >
                            cron
                          </span>
                        )}
                        <StatusDot status={deriveStatus(session)} />
                        <span>{session.messageCount} messages</span>
                        {session.toolCallCount > 0 && (
                          <span>{session.toolCallCount} tool calls</span>
                        )}
                        <span>{formatDate(session.updatedAt)}</span>
                      </div>
                    </div>
                    <svg
                      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                      className="shrink-0 mt-1 transition-transform"
                      style={{
                        color: "var(--text-tertiary)",
                        transform: selectedSession === session.id ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>

                {/* Expanded messages */}
                {selectedSession === session.id && (
                  <div
                    className="rounded-b-xl border border-t-0 px-4 py-3 animate-fade-in"
                    style={{
                      background: "var(--bg-secondary)",
                      borderColor: "var(--border-focus)",
                    }}
                  >
                    {/* Resume affordance — only for non-cron user sessions */}
                    {!session.sessionKey.startsWith("cron:") && !session.sessionKey.startsWith("dm:") && (
                      <div className="flex justify-end mb-2">
                        <Link
                          href={`/chat?s=${encodeURIComponent(session.sessionKey)}&session=${session.id}`}
                          className="text-xs font-medium rounded-lg px-3 py-1.5 border inline-flex items-center gap-1.5"
                          style={{
                            background: "var(--bg-input)",
                            borderColor: "var(--border-primary)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
                          Continue in chat
                        </Link>
                      </div>
                    )}
                    {messagesLoading ? (
                      <div className="flex justify-center py-4">
                        <div
                          className="animate-spin w-4 h-4 border-2 rounded-full"
                          style={{ borderColor: "var(--border-secondary)", borderTopColor: "var(--text-accent)" }}
                        />
                      </div>
                    ) : events.length === 0 ? (
                      <p className="text-xs text-center py-4" style={{ color: "var(--text-tertiary)" }}>
                        No activity in this session
                      </p>
                    ) : (
                      <div className="space-y-3 max-h-[600px] overflow-y-auto">
                        {events.map((ev) =>
                          ev.kind === "tool_call" ? (
                            <ToolCallRow key={ev.id} event={ev} />
                          ) : (
                            <div key={ev.id}>
                              <div className="flex items-center gap-2 mb-0.5">
                                <span
                                  className="text-[10px] font-medium uppercase tracking-wider"
                                  style={{ color: ev.role === "user" ? "var(--text-accent)" : "var(--text-tertiary)" }}
                                >
                                  {ev.role}
                                </span>
                                <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                                  {formatTime(ev.createdAt)}
                                </span>
                              </div>
                              {ev.role === "assistant" ? (
                                <div
                                  className="text-xs prose prose-sm prose-ironclaw max-w-none leading-relaxed
                                    [&_pre]:rounded-lg [&_pre]:p-2 [&_pre]:text-xs [&_pre]:font-mono [&_pre]:border
                                    [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5"
                                  style={{ color: "var(--text-primary)" }}
                                >
                                  {ev.content ? (
                                    <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{normalizeMarkdown(ev.content)}</Markdown>
                                  ) : (
                                    <span className="italic" style={{ color: "var(--text-tertiary)" }}>[no text response]</span>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                                  {ev.content}
                                </p>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Load more button */}
            {hasMore && !searchQuery && agentFilter === "all" && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={loadMoreSessions}
                  disabled={loadingMore}
                  className="text-xs font-medium rounded-lg px-4 py-2 transition-colors border cursor-pointer flex items-center gap-1.5"
                  style={{
                    background: "var(--bg-input)",
                    borderColor: "var(--border-primary)",
                    color: "var(--text-secondary)",
                  }}
                  onMouseEnter={(e) => { if (!loadingMore) e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-input)"; }}
                >
                  {loadingMore && (
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {loadingMore ? "Loading..." : "Load more conversations"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
