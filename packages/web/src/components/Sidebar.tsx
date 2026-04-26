"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useGateway } from "../hooks/GatewayContext";

const NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: ChatIcon },
  { href: "/history", label: "History", icon: HistoryIcon },
  { href: "/approvals", label: "Approvals", icon: CheckIcon },
  { href: "/agents", label: "Agents", icon: AgentsIcon },
  { href: "/crons", label: "Crons", icon: CronsIcon },
] as const;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // Use pending href for optimistic active state, fall back to actual pathname
  const activeHref = pendingHref ?? pathname;
  // Clear pending state when pathname catches up
  if (pendingHref && pathname === pendingHref) {
    setPendingHref(null);
  }
  const { agents, agentName, setAgentName, clearMessages } = useGateway();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function handleAgentChange(name: string) {
    setAgentName(name);
    clearMessages();
    onClose();
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar — fixed overlay on mobile, inline on desktop */}
      <aside
        className={`
          flex flex-col border-r overflow-hidden transition-all duration-200 ease-out
          fixed top-0 left-0 h-full z-50
          lg:relative lg:z-auto
        `}
        style={{
          background: "var(--surface-panel)",
          borderColor: open ? "var(--border-primary)" : "transparent",
          width: open ? "18rem" : "0",
          minWidth: open ? "18rem" : "0",
        }}
      >
        {/* Inner wrapper prevents content from wrapping during width animation */}
        <div className="w-72 min-w-72 flex flex-col h-full">

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 h-14 shrink-0 border-b"
          style={{ borderColor: "var(--border-primary)" }}
        >
          <Link href="/chat" className="flex items-center gap-2" onClick={() => { if (window.innerWidth < 1024) onClose(); }}>
            <img
              src="/ironclaw-icon.png"
              alt="IronClaw"
              className="w-7 h-7 rounded-lg object-cover"
            />
            <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
              IronClaw
            </span>
          </Link>
          {/* Close button visible on mobile/tablet */}
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-md transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Agent selector — always visible when agents exist */}
        {agents.length > 0 && (
          <div className="px-3 py-3 border-b" style={{ borderColor: "var(--border-primary)" }}>
            <label
              className="text-[11px] font-medium uppercase tracking-wider mb-1.5 block"
              style={{ color: "var(--text-tertiary)" }}
            >
              Agent
            </label>
            <div className="relative">
            <select
              value={agentName}
              onChange={(e) => handleAgentChange(e.target.value)}
              className="w-full rounded-lg pl-3 pr-8 py-2 text-sm font-medium focus:outline-none focus:ring-2 transition-colors cursor-pointer appearance-none"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border-primary)",
                color: "var(--text-primary)",
                "--tw-ring-color": "var(--border-focus)",
              } as React.CSSProperties}
            >
              {agents.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name} — {a.persona}
                </option>
              ))}
            </select>
            <svg
              className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              style={{ color: "var(--text-tertiary)" }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = activeHref === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => {
                  setPendingHref(href);
                  if (window.innerWidth < 1024) onClose();
                }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: isActive ? "var(--bg-active)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon active={isActive} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className="px-3 py-3 border-t space-y-0.5"
          style={{ borderColor: "var(--border-primary)" }}
        >
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full transition-colors cursor-pointer"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--status-disconnected)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
        </div>{/* end inner wrapper */}
      </aside>
    </>
  );
}

/* Icon components */
function ChatIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "2"} strokeLinecap="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "2"} strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "2"} strokeLinecap="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  );
}

function AgentsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "2"} strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function CronsIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.5" : "2"} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
      <path d="M5 3l-2 2M19 3l2 2" />
    </svg>
  );
}
