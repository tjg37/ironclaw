"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (data.success) {
        window.location.href = "/chat";
      } else {
        setError(data.error || "Invalid password");
        setPassword("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex-1 flex items-center justify-center min-h-screen px-4"
      style={{ background: "var(--bg-primary)" }}
    >
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <img
            src="/ironclaw-icon.png"
            alt="IronClaw"
            className="w-14 h-14 rounded-xl mx-auto mb-4 object-cover"
          />
          <h1
            className="text-2xl font-semibold tracking-tight mb-1"
            style={{ color: "var(--text-primary)" }}
          >
            IronClaw
          </h1>
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Enter your password to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              disabled={loading}
              className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 disabled:opacity-50 transition-all border"
              style={{
                background: "var(--bg-input)",
                borderColor: "var(--border-primary)",
                color: "var(--text-primary)",
                "--tw-ring-color": "var(--border-focus)",
              } as React.CSSProperties}
            />
          </div>

          {error && (
            <p className="text-sm text-center" style={{ color: "#dc2626" }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full text-sm font-medium rounded-xl px-5 py-3 transition-all disabled:opacity-40"
            style={{
              background: "var(--bg-accent)",
              color: "var(--text-inverse)",
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "var(--bg-accent-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-accent)"; }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
