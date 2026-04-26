import type { Permission } from "./tools.js";

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  permissions: Permission[];
  networkAllowlist?: string[];
  mountPaths?: string[];
  maxExecutionTimeMs?: number;
  entrypoint: string;
}

export interface SkillRecord {
  id: string;
  agentId: string;
  name: string;
  version: string;
  manifest: SkillManifest;
  content: string;
  enabled: boolean;
  sandboxed: boolean;
}
