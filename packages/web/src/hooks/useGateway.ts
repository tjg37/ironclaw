"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  pending?: boolean;
}

interface OutboundMessage {
  id: string;
  sessionKey: string;
  content: string;
  done: boolean;
  metadata?: Record<string, unknown>;
}

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://localhost:18789";

/**
 * SECURITY NOTE: NEXT_PUBLIC_* variables are embedded in the client-side bundle
 * at build time. The gateway token is visible to anyone who can access the web app.
 * This is acceptable for local/trusted network use. For production, implement
 * proper session-based auth (e.g., login → short-lived token → gateway validates).
 */
const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_GATEWAY_TOKEN ?? "";

const MAX_RECONNECT_DELAY = 30_000;

/** Maximum message length enforced client-side (matches gateway's 10KB limit) */
export const MAX_MESSAGE_LENGTH = 10_000;

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useGateway() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const pendingContentRef = useRef("");
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

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

        // Auto-reconnect with exponential backoff
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

          if (pendingIdRef.current) {
            // Accumulate streaming content
            pendingContentRef.current += msg.content;

            if (msg.done) {
              // Replace pending message with final content
              const finalContent = pendingContentRef.current;
              const pId = pendingIdRef.current;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === pId
                    ? { ...m, content: finalContent, pending: false }
                    : m
                )
              );
              pendingIdRef.current = null;
              pendingContentRef.current = "";
            } else {
              // Update streaming content
              const streamContent = pendingContentRef.current;
              const pId = pendingIdRef.current;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === pId ? { ...m, content: streamContent } : m
                )
              );
            }
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
    (content: string) => {
      if (!content.trim()) return;

      if (content.length > MAX_MESSAGE_LENGTH) {
        setError(`Message too long (max ${MAX_MESSAGE_LENGTH.toLocaleString()} characters)`);
        return;
      }

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        pending: false,
      };

      const assistantId = generateId();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        pending: true,
      };

      pendingIdRef.current = assistantId;
      pendingContentRef.current = "";

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ content: content.trim() }));
      } else {
        setError("Not connected to gateway");
        // Remove the pending assistant message
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        pendingIdRef.current = null;
      }
    },
    []
  );

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

  return { send, messages, connected, connecting, error };
}
