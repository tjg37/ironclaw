export interface InboundMessage {
  id: string;
  sessionKey: string;
  channel: string;
  senderId: string;
  content: string;
  /** Target agent name. If omitted, uses the default agent. */
  agentName?: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
  id: string;
  sessionKey: string;
  content: string;
  done: boolean;
  metadata?: Record<string, unknown>;
}

export const NATS_SUBJECTS = {
  INBOUND: "ironclaw.inbound",
  OUTBOUND: "ironclaw.outbound",
} as const;
