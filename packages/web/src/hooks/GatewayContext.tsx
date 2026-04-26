"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  pending?: boolean;
  toolStatus?: string; // e.g., "memory_search", "WebSearch"
  /** When set, the agent is blocked waiting for this tool to be approved in /approvals */
  pendingApproval?: string; // tool name
  page?: string; // which page sent this message
}

interface OutboundMessage {
  id: string;
  sessionKey: string;
  content: string;
  done: boolean;
  metadata?: Record<string, unknown>;
}

export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://localhost:18789";
export const GATEWAY_HTTP_URL = GATEWAY_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";
const MAX_RECONNECT_DELAY = 30_000;

export const MAX_MESSAGE_LENGTH = 10_000;

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export interface AgentInfo {
  name: string;
  persona: string;
}

interface GatewayContextValue {
  send: (content: string, page?: string) => void;
  messages: ChatMessage[];
  connected: boolean;
  connecting: boolean;
  error: string | null;
  clearMessages: () => void;
  agentName: string;
  setAgentName: (name: string) => void;
  agents: AgentInfo[];
  chatSessionKey: string;
  setChatSessionKey: (key: string) => void;
  newChatSessionKey: () => string;
  loadSessionMessages: (sessionId: string) => Promise<void>;
}

export function generateChatSessionKey(): string {
  // Human-readable + collision-resistant: chat:YYYYMMDD-HHMMSS-<rand>
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{6})$/, "$1-$2");
  const rand = Math.random().toString(36).slice(2, 6);
  return `chat:${stamp}-${rand}`;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

export function GatewayProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("default");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [chatSessionKey, setChatSessionKeyState] = useState<string>("main");
  const agentNameRef = useRef("default");
  const chatSessionKeyRef = useRef<string>("main");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  // Track multiple concurrent pending messages: inbound msg ID → assistant msg ID
  const pendingByInboundRef = useRef<Map<string, string>>(new Map());
  // Track accumulated content per assistant message ID
  const pendingContentByIdRef = useRef<Map<string, string>>(new Map());
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    // Don't connect if there's already a connecting socket
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    try {
      const url = GATEWAY_TOKEN
        ? `${GATEWAY_URL}?token=${encodeURIComponent(GATEWAY_TOKEN)}`
        : GATEWAY_URL;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        setConnecting(false);
        setError(null);
        reconnectDelayRef.current = 1000;
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;

        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setError("WebSocket connection error");
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const msg: OutboundMessage = JSON.parse(event.data);

          // Look up which pending assistant message this response belongs to.
          // Use the inbound message ID (msg.id) to match against our tracked
          // mapping, falling back to the most recent pending message.
          const targetId = pendingByInboundRef.current.get(msg.id) ?? pendingIdRef.current;
          if (!targetId) return;

          // Handle tool status events (no content, just metadata)
          const toolStatus = msg.metadata?.toolStatus as string | undefined;
          const toolName = msg.metadata?.toolName as string | undefined;
          if (toolStatus && toolName && !msg.content && !msg.done) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== targetId) return m;
                if (toolStatus === "pending_approval") {
                  // Agent is blocked on /approvals — surface a distinct indicator.
                  return { ...m, pendingApproval: toolName, toolStatus: undefined };
                }
                if (toolStatus === "approval_resolved") {
                  // User decided; clear the waiting state and let the next status update.
                  return { ...m, pendingApproval: undefined };
                }
                const status = toolStatus === "start" ? toolName : undefined;
                return { ...m, toolStatus: status, pendingApproval: undefined };
              }),
            );
            return;
          }

          // Accumulate streamed content per assistant message
          const prevContent = pendingContentByIdRef.current.get(targetId) ?? "";
          const newContent = prevContent + msg.content;
          pendingContentByIdRef.current.set(targetId, newContent);

          if (msg.done) {
            const finalContent = newContent || "(No response)";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? { ...m, content: finalContent, pending: false, toolStatus: undefined, pendingApproval: undefined }
                  : m,
              ),
            );
            // Clean up tracking state for this message
            pendingContentByIdRef.current.delete(targetId);
            pendingByInboundRef.current.delete(msg.id);
            if (pendingIdRef.current === targetId) {
              pendingIdRef.current = null;
            }
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId ? { ...m, content: newContent, toolStatus: undefined, pendingApproval: undefined } : m,
              ),
            );
          }
        } catch {
          // Ignore malformed messages
        }
      };
    } catch {
      setError("Failed to create WebSocket connection");
    }
  }, []);

  const send = useCallback(
    (content: string, page?: string) => {
      if (!content.trim()) return;

      if (content.length > MAX_MESSAGE_LENGTH) {
        setError(
          `Message too long (max ${MAX_MESSAGE_LENGTH.toLocaleString()} characters)`,
        );
        return;
      }

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        pending: false,
        page,
      };

      const assistantId = generateId();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        pending: true,
        page,
      };

      pendingIdRef.current = assistantId;

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Generate a unique inbound message ID that the gateway will echo back,
        // allowing us to match responses to the correct assistant message
        const inboundId = generateId();
        pendingByInboundRef.current.set(inboundId, assistantId);
        pendingContentByIdRef.current.set(assistantId, "");

        const payload: Record<string, string> = { id: inboundId, content: content.trim() };
        if (agentNameRef.current && agentNameRef.current !== "default") {
          payload.agentName = agentNameRef.current;
        }
        if (chatSessionKeyRef.current && chatSessionKeyRef.current !== "main") {
          payload.sessionKey = chatSessionKeyRef.current;
        }
        wsRef.current.send(JSON.stringify(payload));
      } else {
        setError("Not connected to gateway");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        pendingIdRef.current = null;
      }
    },
    [],
  );

  const updateAgentName = useCallback((name: string) => {
    setAgentName(name);
    agentNameRef.current = name;
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const updateChatSessionKey = useCallback((key: string) => {
    chatSessionKeyRef.current = key;
    setChatSessionKeyState(key);
    setMessages([]); // switching chats clears the in-memory transcript
  }, []);

  const newChatSessionKey = useCallback(() => {
    const key = generateChatSessionKey();
    updateChatSessionKey(key);
    return key;
  }, [updateChatSessionKey]);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    const tokenParam = GATEWAY_TOKEN ? `?token=${encodeURIComponent(GATEWAY_TOKEN)}` : "";
    const res = await fetch(`${GATEWAY_HTTP_URL}/sessions/${sessionId}/messages${tokenParam}`);
    if (!res.ok) throw new Error("Failed to load session messages");
    const data = (await res.json()) as Array<{ id: string; role: string; content: string; createdAt: string }>;
    const loaded: ChatMessage[] = data
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: new Date(m.createdAt),
        pending: false,
      }));
    setMessages(loaded);
  }, []);

  // Fetch available agents once on mount
  useEffect(() => {
    const tokenParam = GATEWAY_TOKEN ? `?token=${encodeURIComponent(GATEWAY_TOKEN)}` : "";
    fetch(`${GATEWAY_HTTP_URL}/agents${tokenParam}`)
      .then((res) => res.ok ? res.json() : [])
      .then((data: AgentInfo[]) => { if (mountedRef.current) setAgents(data); })
      .catch((err) => console.error("Failed to fetch agents:", err));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return (
    <GatewayContext.Provider
      value={{
        send,
        messages,
        connected,
        connecting,
        error,
        clearMessages,
        agentName,
        setAgentName: updateAgentName,
        agents,
        chatSessionKey,
        setChatSessionKey: updateChatSessionKey,
        newChatSessionKey,
        loadSessionMessages,
      }}
    >
      {children}
    </GatewayContext.Provider>
  );
}

export function useGateway(page?: string) {
  const ctx = useContext(GatewayContext);
  if (!ctx) {
    throw new Error("useGateway must be used within a GatewayProvider");
  }

  // Filter messages for this page if specified. Untagged messages (e.g. messages
  // loaded from history for the chat view) are shown everywhere — only messages that
  // were explicitly tagged with a different page are hidden.
  const messages = page
    ? ctx.messages.filter((m) => !m.page || m.page === page)
    : ctx.messages;

  return {
    send: (content: string) => ctx.send(content, page),
    messages,
    connected: ctx.connected,
    connecting: ctx.connecting,
    error: ctx.error,
    clearMessages: ctx.clearMessages,
    agentName: ctx.agentName,
    setAgentName: ctx.setAgentName,
    agents: ctx.agents,
    chatSessionKey: ctx.chatSessionKey,
    setChatSessionKey: ctx.setChatSessionKey,
    newChatSessionKey: ctx.newChatSessionKey,
    loadSessionMessages: ctx.loadSessionMessages,
  };
}
