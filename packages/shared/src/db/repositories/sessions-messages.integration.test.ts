import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as sessionRepo from "./sessions.js";
import * as messageRepo from "./messages.js";
import { createTestAgent, cleanAllTables, closeDb } from "../../test-utils/helpers.js";

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await cleanAllTables();
});

describe("sessions (integration)", () => {
  it("creates a new session for an agent", async () => {
    const agent = await createTestAgent("session-test-agent");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");
    expect(session.id).toBeDefined();
    expect(session.sessionKey).toBe("main");
    expect(session.trustLevel).toBe("operator"); // default
  });

  it("returns existing session on duplicate key", async () => {
    const agent = await createTestAgent("session-idempotent");
    const first = await sessionRepo.findOrCreateSession(agent.id, "main");
    const second = await sessionRepo.findOrCreateSession(agent.id, "main");
    expect(first.id).toBe(second.id);
  });

  it("creates separate sessions per agent", async () => {
    const agent1 = await createTestAgent("agent-1");
    const agent2 = await createTestAgent("agent-2");
    const session1 = await sessionRepo.findOrCreateSession(agent1.id, "main");
    const session2 = await sessionRepo.findOrCreateSession(agent2.id, "main");
    expect(session1.id).not.toBe(session2.id);
  });

  it("creates separate sessions per key", async () => {
    const agent = await createTestAgent("multi-session");
    const main = await sessionRepo.findOrCreateSession(agent.id, "main");
    const delegation = await sessionRepo.findOrCreateSession(agent.id, "agent:source:target");
    expect(main.id).not.toBe(delegation.id);
  });

  it("respects trust level parameter", async () => {
    const agent = await createTestAgent("trust-test");
    const session = await sessionRepo.findOrCreateSession(agent.id, "untrusted-session", "untrusted");
    expect(session.trustLevel).toBe("untrusted");
  });

  it("gets session by ID", async () => {
    const agent = await createTestAgent("get-session");
    const created = await sessionRepo.findOrCreateSession(agent.id, "main");
    const found = await sessionRepo.getSession(created.id);
    expect(found).not.toBeNull();
    expect(found!.sessionKey).toBe("main");
  });

  it("returns null for non-existent session ID", async () => {
    const found = await sessionRepo.getSession("00000000-0000-0000-0000-000000000000");
    expect(found).toBeNull();
  });

  it("updates session timestamp", async () => {
    const agent = await createTestAgent("timestamp-test");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");
    const before = session.updatedAt;

    // Small delay to ensure Postgres timestamp changes — fake timers don't work
    // here because the timestamp is set server-side via new Date() in the repo,
    // not in the test process.
    await new Promise((r) => setTimeout(r, 50));
    await sessionRepo.updateSessionTimestamp(session.id);

    const updated = await sessionRepo.getSession(session.id);
    expect(updated!.updatedAt!.getTime()).toBeGreaterThanOrEqual(before!.getTime());
  });
});

describe("messages (integration)", () => {
  it("appends a message to a session", async () => {
    const agent = await createTestAgent("msg-agent");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");

    const msg = await messageRepo.appendMessage(session.id, "user", "Hello!");
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello!");
    expect(msg.sessionId).toBe(session.id);
  });

  it("retrieves messages in order", async () => {
    const agent = await createTestAgent("msg-order");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");

    await messageRepo.appendMessage(session.id, "user", "First");
    await messageRepo.appendMessage(session.id, "assistant", "Second");
    await messageRepo.appendMessage(session.id, "user", "Third");

    const messages = await messageRepo.getSessionMessages(session.id);
    expect(messages).toHaveLength(3);
    expect(messages[0]!.content).toBe("First");
    expect(messages[1]!.content).toBe("Second");
    expect(messages[2]!.content).toBe("Third");
  });

  it("respects limit parameter", async () => {
    const agent = await createTestAgent("msg-limit");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");

    await messageRepo.appendMessage(session.id, "user", "One");
    await messageRepo.appendMessage(session.id, "user", "Two");
    await messageRepo.appendMessage(session.id, "user", "Three");

    const messages = await messageRepo.getSessionMessages(session.id, 2);
    expect(messages).toHaveLength(2);
  });

  it("isolates messages between sessions", async () => {
    const agent = await createTestAgent("msg-isolation");
    const session1 = await sessionRepo.findOrCreateSession(agent.id, "main");
    const session2 = await sessionRepo.findOrCreateSession(agent.id, "agent:other:target");

    await messageRepo.appendMessage(session1.id, "user", "Session 1 message");
    await messageRepo.appendMessage(session2.id, "user", "Session 2 message");

    const msgs1 = await messageRepo.getSessionMessages(session1.id);
    const msgs2 = await messageRepo.getSessionMessages(session2.id);
    expect(msgs1).toHaveLength(1);
    expect(msgs2).toHaveLength(1);
    expect(msgs1[0]!.content).toBe("Session 1 message");
    expect(msgs2[0]!.content).toBe("Session 2 message");
  });

  it("deletes messages by ID", async () => {
    const agent = await createTestAgent("msg-delete");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");

    const msg1 = await messageRepo.appendMessage(session.id, "user", "Keep");
    const msg2 = await messageRepo.appendMessage(session.id, "user", "Delete me");

    const deleted = await messageRepo.deleteMessages([msg2.id], session.id);
    expect(deleted).toBe(1);

    const remaining = await messageRepo.getSessionMessages(session.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(msg1.id);
  });

  it("counts session messages", async () => {
    const agent = await createTestAgent("msg-count");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");

    expect(await messageRepo.getSessionMessageCount(session.id)).toBe(0);

    await messageRepo.appendMessage(session.id, "user", "One");
    await messageRepo.appendMessage(session.id, "assistant", "Two");

    expect(await messageRepo.getSessionMessageCount(session.id)).toBe(2);
  });

  it("stores metadata on messages", async () => {
    const agent = await createTestAgent("msg-metadata");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");

    const msg = await messageRepo.appendMessage(session.id, "user", "Hello", { source: "telegram" });
    expect(msg.metadata).toEqual({ source: "telegram" });
  });
});

describe("delegation session isolation (integration)", () => {
  it("delegation sessions are separate from human sessions", async () => {
    const agent = await createTestAgent("delegate-target");
    const humanSession = await sessionRepo.findOrCreateSession(agent.id, "main");
    const delegationSession = await sessionRepo.findOrCreateSession(agent.id, "agent:source:delegate-target", "untrusted");

    await messageRepo.appendMessage(humanSession.id, "user", "Human message");
    await messageRepo.appendMessage(delegationSession.id, "user", "Delegation message");

    const humanMsgs = await messageRepo.getSessionMessages(humanSession.id);
    const delegateMsgs = await messageRepo.getSessionMessages(delegationSession.id);

    expect(humanMsgs).toHaveLength(1);
    expect(delegateMsgs).toHaveLength(1);
    expect(humanMsgs[0]!.content).toBe("Human message");
    expect(delegateMsgs[0]!.content).toBe("Delegation message");
  });

  it("delegation sessions have untrusted trust level", async () => {
    const agent = await createTestAgent("delegate-trust");
    const session = await sessionRepo.findOrCreateSession(agent.id, "agent:caller:delegate-trust", "untrusted");
    expect(session.trustLevel).toBe("untrusted");
  });

  it("stable delegation session key returns same session", async () => {
    const agent = await createTestAgent("delegate-stable");
    const first = await sessionRepo.findOrCreateSession(agent.id, "agent:source:delegate-stable");
    await messageRepo.appendMessage(first.id, "user", "First delegation");

    const second = await sessionRepo.findOrCreateSession(agent.id, "agent:source:delegate-stable");
    await messageRepo.appendMessage(second.id, "user", "Second delegation");

    expect(first.id).toBe(second.id);

    const allMsgs = await messageRepo.getSessionMessages(first.id);
    expect(allMsgs).toHaveLength(2);
  });
});
