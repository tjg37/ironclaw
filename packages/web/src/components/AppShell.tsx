"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { useGateway } from "../hooks/GatewayContext";

export default function AppShell({ children }: { children: React.ReactNode }) {
  // Start closed (safe for SSR), then open on desktop after mount
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (window.innerWidth >= 1024) setSidebarOpen(true);
  }, []);
  const pathname = usePathname();
  const { connected, connecting, agentName, agents } = useGateway();

  // Don't wrap login page in the shell
  if (pathname === "/login") {
    return <>{children}</>;
  }

  // Render a minimal placeholder during SSR to avoid hydration mismatch
  // (env() CSS values and window-dependent state differ between server and client)
  if (!mounted) {
    return <div style={{ background: "var(--bg-primary)", height: "100vh" }} />;
  }

  const currentAgent = agents.find((a) => a.name === agentName);
  const showAgentInHeader = pathname === "/chat" && agents.length > 0;

  return (
    <div
      className="fixed inset-0 flex"
      style={{
        background: "var(--bg-primary)",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {mounted && <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between h-14 px-4 shrink-0 border-b"
          style={{
            background: "var(--surface-overlay)",
            borderColor: "var(--border-primary)",
          }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-md transition-colors cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>

            <PageTitle pathname={pathname} />

            {showAgentInHeader && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>/</span>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-md"
                  style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                >
                  {agentName}{currentAgent?.persona && currentAgent.persona !== "general" ? ` (${currentAgent.persona})` : ""}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background: connected
                  ? "var(--status-connected)"
                  : connecting
                    ? "var(--status-connecting)"
                    : "var(--status-disconnected)",
                animation: connecting ? "pulse 2s infinite" : undefined,
              }}
            />
            <span className="text-xs hidden sm:inline" style={{ color: "var(--text-tertiary)" }}>
              {connected ? "Connected" : connecting ? "Connecting..." : "Disconnected"}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 flex flex-col min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}

function PageTitle({ pathname }: { pathname: string }) {
  const titles: Record<string, string> = {
    "/chat": "Chat",
    "/history": "History",
    "/approvals": "Approvals",
    "/agents": "Agents",
  };

  return (
    <h1
      className="text-sm font-semibold"
      style={{ color: "var(--text-primary)" }}
    >
      {titles[pathname] ?? "IronClaw"}
    </h1>
  );
}
