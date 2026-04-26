import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as sessionRepo from "./sessions.js";
import * as toolExecutionRepo from "./tool-executions.js";
import { createTestAgent, cleanAllTables, closeDb } from "../../test-utils/helpers.js";

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await cleanAllTables();
});

describe("tool-executions approval flow (integration)", () => {
  it("createPendingApproval writes a row with status=pending and the provided input", async () => {
    const agent = await createTestAgent("approval-pending");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");

    const pending = await toolExecutionRepo.createPendingApproval({
      sessionId: session.id,
      toolName: "Bash",
      input: { command: "ls -la" },
    });

    expect(pending.id).toBeDefined();
    expect(pending.status).toBe("pending");
    expect(pending.approvalRequired).toBe(true);
    expect(pending.input).toEqual({ command: "ls -la" });
    expect(pending.approvedAt).toBeNull();
  });

  it("listPendingApprovals returns only pending rows with session + agent context", async () => {
    const agent = await createTestAgent("approval-list");
    const session = await sessionRepo.findOrCreateSession(agent.id, "chat:abc");

    await toolExecutionRepo.createPendingApproval({
      sessionId: session.id,
      toolName: "WebFetch",
      input: { url: "https://example.com" },
    });
    // A non-pending row should not appear
    await toolExecutionRepo.logToolExecution({
      sessionId: session.id,
      toolName: "Read",
      permissionsUsed: [],
      input: { file_path: "/x.ts" },
      output: { success: true },
      status: "executed",
      approvalRequired: false,
      durationMs: 10,
    });

    const pending = await toolExecutionRepo.listPendingApprovals();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.toolName).toBe("WebFetch");
    expect(pending[0]!.agentName).toBe("approval-list");
    expect(pending[0]!.sessionKey).toBe("chat:abc");
  });

  it("resolveApproval flips a pending row to approved", async () => {
    const agent = await createTestAgent("approval-approve");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");
    const pending = await toolExecutionRepo.createPendingApproval({
      sessionId: session.id,
      toolName: "Bash",
      input: { command: "echo hi" },
    });

    const updated = await toolExecutionRepo.resolveApproval(pending.id, true);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("approved");
    expect(updated!.approvedAt).not.toBeNull();
  });

  it("resolveApproval flips a pending row to denied", async () => {
    const agent = await createTestAgent("approval-deny");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");
    const pending = await toolExecutionRepo.createPendingApproval({
      sessionId: session.id,
      toolName: "Bash",
      input: { command: "rm -rf /" },
    });

    const updated = await toolExecutionRepo.resolveApproval(pending.id, false);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("denied");
  });

  it("resolveApproval returns null when the row is not pending (no double-resolve)", async () => {
    const agent = await createTestAgent("approval-double");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");
    const pending = await toolExecutionRepo.createPendingApproval({
      sessionId: session.id,
      toolName: "Bash",
      input: {},
    });
    await toolExecutionRepo.resolveApproval(pending.id, true);
    const second = await toolExecutionRepo.resolveApproval(pending.id, false);
    expect(second).toBeNull();
  });

  it("waitForApprovalResolution resolves to 'approved' once the row is flipped", async () => {
    const agent = await createTestAgent("approval-wait-approved");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");
    const pending = await toolExecutionRepo.createPendingApproval({
      sessionId: session.id,
      toolName: "Bash",
      input: {},
    });

    // Flip to approved in the background; waitForApprovalResolution should see it on next poll.
    setTimeout(() => {
      void toolExecutionRepo.resolveApproval(pending.id, true);
    }, 100);

    const outcome = await toolExecutionRepo.waitForApprovalResolution(pending.id, 5000, 50);
    expect(outcome).toBe("approved");
  });

  it("waitForApprovalResolution returns 'timeout' and marks the row denied when deadline hits", async () => {
    const agent = await createTestAgent("approval-wait-timeout");
    const session = await sessionRepo.findOrCreateSession(agent.id, "main");
    const pending = await toolExecutionRepo.createPendingApproval({
      sessionId: session.id,
      toolName: "Bash",
      input: {},
    });

    const outcome = await toolExecutionRepo.waitForApprovalResolution(pending.id, 120, 50);
    expect(outcome).toBe("timeout");

    // The row should now be flagged denied so it disappears from the pending list.
    const stillPending = await toolExecutionRepo.listPendingApprovals();
    expect(stillPending.find((r) => r.id === pending.id)).toBeUndefined();
  });
});
