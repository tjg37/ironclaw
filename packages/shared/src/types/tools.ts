export type Permission =
  | "file:read"
  | "file:write"
  | "file:delete"
  | "bash:allowlist"
  | "bash:unrestricted"
  | "network:allowlist"
  | "network:unrestricted"
  | "browser:read"
  | "browser:interact"
  | "email:read"
  | "email:send"
  | "calendar:read"
  | "calendar:write"
  | "system:notify";

/** All valid Permission values — used for manifest validation */
export const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "file:read", "file:write", "file:delete",
  "bash:allowlist", "bash:unrestricted",
  "network:allowlist", "network:unrestricted",
  "browser:read", "browser:interact",
  "email:read", "email:send",
  "calendar:read", "calendar:write",
  "system:notify",
]);

// Permissions that always require user approval before execution
export const ALWAYS_APPROVE: ReadonlySet<Permission> = new Set([
  "file:write",
  "file:delete",
  "email:send",
  "bash:allowlist",
  "bash:unrestricted",
  "network:allowlist",
  "network:unrestricted",
  "calendar:write",
  "browser:interact",
]);

// Permissions that are auto-approved (no confirmation needed)
export const AUTO_APPROVE: ReadonlySet<Permission> = new Set([
  "file:read",
  "calendar:read",
  "system:notify",
  "browser:read",
  "email:read",
]);

export interface ToolDefinition {
  name: string;
  description: string;
  permissions: Permission[];
  parameters: Record<string, ToolParameter>;
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolContext {
  sessionId: string;
  trustLevel: string;
  agentId?: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
