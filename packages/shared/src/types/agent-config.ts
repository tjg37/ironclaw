/** Single source of truth for valid persona values */
export const PERSONA_KEYS = [
  "general", "developer", "research", "organizer",
  "writer", "data_analyst", "devops", "product_manager", "custom",
] as const;

export type Persona = (typeof PERSONA_KEYS)[number];

export interface AgentConfig {
  persona?: Persona;
  /** Free-text persona description, used when persona === "custom" */
  customPersona?: string;
  boundaries?: {
    allowBash?: boolean;
    allowFileWrites?: boolean;
    allowWebSearch?: boolean;
    allowSystemFiles?: boolean;
  };
  mcpConnections?: Array<"memory" | "github" | "sentry" | "slack" | "google_calendar">;
  /** Anthropic model override for this agent (e.g., "claude-haiku-4-5-20251001") */
  model?: string;
  /** Agents this agent is allowed to communicate with via ask_agent/tell_agent */
  allowedAgents?: string[];
}

/** Regex for valid agent names — shared across validation and routing */
export const AGENT_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

const VALID_PERSONAS = new Set<string>(PERSONA_KEYS);
const VALID_MCP_CONNECTIONS = new Set(["memory", "github", "sentry", "slack", "google_calendar"]);
const VALID_BOUNDARY_KEYS = new Set(["allowBash", "allowFileWrites", "allowWebSearch", "allowSystemFiles"]);

/** Validate an AgentConfig at runtime. Throws on invalid values. */
export function validateAgentConfig(config: unknown): AgentConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Agent config must be a plain object");
  }
  const c = config as Record<string, unknown>;

  if (c.persona !== undefined && (typeof c.persona !== "string" || !VALID_PERSONAS.has(c.persona))) {
    throw new Error(`Invalid persona: "${String(c.persona)}". Valid: ${[...VALID_PERSONAS].join(", ")}`);
  }

  if (c.persona === "custom") {
    if (!c.customPersona || typeof c.customPersona !== "string" || c.customPersona.trim().length === 0) {
      throw new Error('customPersona is required when persona is "custom"');
    }
    if (c.customPersona.length > 1000) {
      throw new Error("customPersona must be 1000 characters or less");
    }
  }

  if (c.boundaries !== undefined) {
    if (typeof c.boundaries !== "object" || c.boundaries === null) {
      throw new Error("boundaries must be an object");
    }
    for (const [key, value] of Object.entries(c.boundaries as Record<string, unknown>)) {
      if (!VALID_BOUNDARY_KEYS.has(key)) {
        throw new Error(`Unknown boundary key: "${key}". Valid: ${[...VALID_BOUNDARY_KEYS].join(", ")}`);
      }
      if (typeof value !== "boolean") {
        throw new Error(`Boundary "${key}" must be a boolean, got ${typeof value}`);
      }
    }
  }

  if (c.model !== undefined) {
    if (typeof c.model !== "string" || !/^claude-[\w.-]+$/.test(c.model)) {
      throw new Error(`Invalid model: "${String(c.model)}". Must start with "claude-" and contain only alphanumeric characters, hyphens, dots, and underscores.`);
    }
  }

  if (c.mcpConnections !== undefined) {
    if (!Array.isArray(c.mcpConnections)) {
      throw new Error("mcpConnections must be an array");
    }
    for (const conn of c.mcpConnections) {
      if (!VALID_MCP_CONNECTIONS.has(conn as string)) {
        throw new Error(`Invalid MCP connection: "${String(conn)}". Valid: ${[...VALID_MCP_CONNECTIONS].join(", ")}`);
      }
    }
  }

  if (c.allowedAgents !== undefined) {
    if (!Array.isArray(c.allowedAgents)) {
      throw new Error("allowedAgents must be an array");
    }
    for (const name of c.allowedAgents) {
      if (typeof name !== "string" || !AGENT_NAME_REGEX.test(name)) {
        throw new Error(`Invalid agent name in allowedAgents: "${String(name)}". Must be 1-64 characters using only letters, numbers, hyphens, and underscores.`);
      }
    }
  }

  return config as AgentConfig;
}
