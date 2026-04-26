"use client";

import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useGateway, MAX_MESSAGE_LENGTH } from "../../hooks/GatewayContext";
import ChatMessage from "../../components/ChatMessage";

export default function ChatPage() {
  const {
    send,
    messages,
    connected,
    error,
    agentName,
    agents,
    chatSessionKey,
    setChatSessionKey,
    newChatSessionKey,
    loadSessionMessages,
  } = useGateway("chat");
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Sync the URL ?s=<key>&session=<id> params into the client-side session state.
  // ?s is the logical sessionKey (new chats) and ?session is a concrete session id
  // (resumed from /history) whose messages get loaded up front.
  useEffect(() => {
    const urlKey = searchParams?.get("s") ?? null;
    const resumeId = searchParams?.get("session") ?? null;
    if (urlKey && urlKey !== chatSessionKey) {
      setChatSessionKey(urlKey);
    } else if (!urlKey && chatSessionKey !== "main") {
      setChatSessionKey("main");
    }
    if (resumeId) {
      loadSessionMessages(resumeId).catch(() => {/* surface via error state */});
    }
    // only react to URL changes, not our own setState
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function handleNewChat() {
    const key = newChatSessionKey();
    router.push(`/chat?s=${encodeURIComponent(key)}`);
  }

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // Max ~6 lines (6 * 20px line height = 120px)
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isOverLimit = input.length > MAX_MESSAGE_LENGTH;
  const showCharCount = input.length > MAX_MESSAGE_LENGTH * 0.8;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || !connected || isOverLimit) return;
    send(input);
    setInput("");
  }

  const isNewChatSession = chatSessionKey !== "main";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Subheader with New chat affordance */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: "var(--border-primary)" }}
      >
        <p className="text-xs truncate" style={{ color: "var(--text-tertiary)" }}>
          {isNewChatSession ? `Conversation · ${chatSessionKey.replace("chat:", "")}` : "Main conversation"}
        </p>
        <button
          onClick={handleNewChat}
          disabled={!connected}
          className="text-xs font-medium rounded-lg px-3 py-1.5 transition-colors border disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
          style={{
            background: "var(--bg-input)",
            borderColor: "var(--border-primary)",
            color: "var(--text-secondary)",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New chat
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="px-4 py-2 text-xs font-medium border-b"
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            borderColor: "#fecaca",
          }}
        >
          {error}
        </div>
      )}

      {/* Messages — dismiss keyboard on scroll */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ WebkitOverflowScrolling: "touch" }}
        onTouchMove={() => {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }}
      >
        <div className="max-w-2xl mx-auto space-y-1">
          {messages.length === 0 && (
            <div className="flex items-center justify-center" style={{ minHeight: "50%" }}>
              <div className="text-center">
                <img
                  src="/ironclaw-icon.png"
                  alt="IronClaw"
                  className="w-20 h-20 rounded-2xl mx-auto mb-4 object-cover"
                />
                <p className="text-lg font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                  IronClaw
                </p>
                <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                  {agents.length > 1
                    ? `Chatting with ${agentName}`
                    : "Send a message to get started"}
                </p>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div
        className="shrink-0 border-t px-4 py-3"
        style={{
          background: "var(--surface-overlay)",
          borderColor: "var(--border-primary)",
          backdropFilter: "blur(8px)",
        }}
      >
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex items-center gap-2">
          <div
            className="flex-1 rounded-xl border px-3 py-1 transition-colors"
            style={{
              background: "var(--bg-input)",
              borderColor: "var(--border-primary)",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); resizeTextarea(); }}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && connected && !isOverLimit) {
                    send(input);
                    setInput("");
                    setTimeout(resizeTextarea, 0);
                  }
                }
              }}
              placeholder={connected ? "Message IronClaw..." : "Connecting..."}
              disabled={!connected}
              rows={1}
              className="w-full bg-transparent py-2 text-sm focus:outline-none disabled:opacity-50 placeholder:text-[var(--text-tertiary)] resize-none overflow-y-auto"
              style={{ color: "var(--text-primary)", maxHeight: "120px" }}
            />
          </div>
          <button
            type="submit"
            disabled={!connected || !input.trim() || isOverLimit}
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-30 cursor-pointer"
            style={{
              background: connected && input.trim() && !isOverLimit ? "var(--bg-accent)" : "var(--bg-hover)",
              color: connected && input.trim() && !isOverLimit ? "var(--text-inverse)" : "var(--text-tertiary)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
          {showCharCount && (
            <div
              className="text-xs mt-1 text-right"
              style={{ color: isOverLimit ? "#dc2626" : "var(--text-tertiary)" }}
            >
              {input.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
