const VALID_AUTH_MODES = ["api_key", "max_plan"] as const;
type AuthMode = (typeof VALID_AUTH_MODES)[number];

function parseAuthMode(): AuthMode {
  const raw = process.env["AUTH_MODE"] ?? "api_key";
  if (!(VALID_AUTH_MODES as readonly string[]).includes(raw)) {
    console.error(`Invalid AUTH_MODE="${raw}". Valid values: ${VALID_AUTH_MODES.join(", ")}. Defaulting to "api_key".`);
    return "api_key";
  }
  return raw as AuthMode;
}

export const config = {
  /** Authentication mode: "api_key" uses ANTHROPIC_API_KEY, "max_plan" uses Claude CLI auth */
  authMode: parseAuthMode(),
  anthropicApiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
  anthropicModel: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-20250514",
  /** Fast/cheap model for background tasks (auto-extraction, compaction, fact parsing) */
  anthropicFastModel: process.env["ANTHROPIC_FAST_MODEL"] ?? "claude-haiku-4-5-20251001",
  voyageApiKey: process.env["VOYAGE_API_KEY"] ?? "",
  /** Tavily API key for web search (free tier: 1000 queries/month) */
  tavilyApiKey: process.env["TAVILY_API_KEY"] ?? "",
  /** GitHub personal access token for the GitHub MCP server */
  githubToken: process.env["GITHUB_TOKEN"] ?? "",
  /** Sentry auth token for the Sentry MCP server */
  sentryAuthToken: process.env["SENTRY_AUTH_TOKEN"] ?? "",
  /** Directory for agent notes/documents */
  notesDir: process.env["IRONCLAW_NOTES_DIR"] ?? "",
  databaseUrl:
    process.env["DATABASE_URL"] ??
    "postgres://ironclaw:dev_password@localhost:5433/ironclaw",
} as const;
