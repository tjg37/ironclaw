"use client";

import Markdown from "react-markdown";
import { REMARK_PLUGINS, MARKDOWN_COMPONENTS, normalizeMarkdown } from "../lib/markdown";
import type { ChatMessage as ChatMessageType } from "../hooks/GatewayContext";

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]" style={{ background: "var(--text-tertiary)" }} />
      <span className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:150ms]" style={{ background: "var(--text-tertiary)" }} />
      <span className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:300ms]" style={{ background: "var(--text-tertiary)" }} />
    </span>
  );
}

/** Format tool names for display: memory_search -> Searching memory */
function formatToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    memory_store: "Storing memory",
    memory_search: "Searching memory",
    memory_list: "Listing memories",
    memory_delete: "Deleting memory",
    memory_forget: "Forgetting",
    system_health: "Checking health",
    session_list: "Listing sessions",
    tool_logs: "Reading tool logs",
    usage_metrics: "Checking usage",
    cron_list: "Listing cron jobs",
    cron_manage: "Managing cron job",
    skills_list: "Listing skills",
    channel_status: "Checking channels",
    ask_agent: "Consulting agent",
    tell_agent: "Messaging agent",
    WebSearch: "Searching the web",
    WebFetch: "Fetching page",
    Read: "Reading file",
    Write: "Writing file",
    Edit: "Editing file",
    Bash: "Running command",
    Glob: "Finding files",
    Grep: "Searching code",
  };
  return labels[toolName] ?? `Using ${toolName}`;
}

function ToolStatusIndicator({ toolName }: { toolName: string }) {
  return (
    <div className="flex items-center gap-2 text-sm py-1" style={{ color: "var(--text-tertiary)" }}>
      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="font-mono text-xs">{formatToolLabel(toolName)}</span>
    </div>
  );
}

function PendingApprovalIndicator({ toolName }: { toolName: string }) {
  return (
    <div
      className="flex items-center gap-2 text-xs py-1.5 px-2.5 rounded-lg border"
      style={{
        background: "rgb(251 191 36 / 0.1)",
        borderColor: "rgb(251 191 36 / 0.4)",
        color: "rgb(180 83 9)",
      }}
    >
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span>
        Waiting for your approval of <span className="font-mono">{toolName}</span> —{" "}
        <a href="/approvals" className="underline underline-offset-2 font-medium">review in Approvals</a>
      </span>
    </div>
  );
}

export default function ChatMessage({ message }: { message: ChatMessageType }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center py-2">
        <div className="text-xs italic max-w-md text-center" style={{ color: "var(--text-tertiary)" }}>
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end py-1.5 animate-fade-in">
        <div
          className="max-w-[75%] rounded-2xl rounded-br-sm px-4 py-2.5"
          style={{ background: "var(--bg-user-bubble)", color: "var(--text-inverse)" }}
        >
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {message.content}
          </p>
          <div className="text-[10px] mt-1 opacity-50">
            {formatTime(message.timestamp)}
          </div>
        </div>
      </div>
    );
  }

  // Assistant messages
  return (
    <div className="py-3 animate-fade-in">
      {message.pending && !message.content ? (
        <div className="py-1">
          {message.pendingApproval ? (
            <PendingApprovalIndicator toolName={message.pendingApproval} />
          ) : message.toolStatus ? (
            <ToolStatusIndicator toolName={message.toolStatus} />
          ) : (
            <LoadingDots />
          )}
        </div>
      ) : (
        <div
          className="text-sm prose prose-sm prose-ironclaw max-w-none leading-relaxed
            [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-sm [&_pre]:font-mono
            [&_pre]:border [&_code]:text-sm [&_code]:font-mono
            [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5
            [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5
            [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5
            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1
            [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse
            [&_th]:text-left [&_th]:font-semibold [&_th]:px-2 [&_th]:py-1 [&_th]:border-b
            [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-[var(--border-subtle)]
            [&_th]:border-[var(--border-subtle)]
            [&_a]:underline [&_a]:underline-offset-2"
          style={{
            "--tw-prose-body": "var(--text-primary)",
            "--tw-prose-headings": "var(--text-primary)",
            "--tw-prose-links": "var(--text-link)",
            "--tw-prose-bold": "var(--text-primary)",
            "--tw-prose-code": "var(--text-accent)",
          } as React.CSSProperties}
        >
          {/* react-markdown is safe by default (no raw HTML rendering).
              Do NOT add rehype-raw or similar plugins without XSS sanitization. */}
          <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{normalizeMarkdown(message.content)}</Markdown>
          {message.pending && (
            <span className="inline-block ml-1">
              {message.pendingApproval ? (
                <PendingApprovalIndicator toolName={message.pendingApproval} />
              ) : message.toolStatus ? (
                <ToolStatusIndicator toolName={message.toolStatus} />
              ) : (
                <LoadingDots />
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
