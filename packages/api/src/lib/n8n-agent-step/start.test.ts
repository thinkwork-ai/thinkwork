import { describe, expect, it, vi } from "vitest";
import { startN8nAgentStepRun } from "./start.js";

describe("startN8nAgentStepRun", () => {
  it("replays an existing idempotency key without creating a thread", async () => {
    const existingRun = {
      id: "66666666-6666-4666-8666-666666666666",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      status: "waiting",
      thread_id: "88888888-8888-4888-8888-888888888888",
      opening_message_id: "99999999-9999-4999-8999-999999999999",
      expires_at: new Date("2026-06-21T12:00:00.000Z"),
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [existingRun]),
          })),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const ensureThread = vi.fn();

    const result = await startN8nAgentStepRun(
      {
        tenantId: "11111111-1111-4111-8111-111111111111",
        tenantSlug: "acme",
        pluginInstallId: "22222222-2222-4222-8222-222222222222",
        managedApplicationId: "33333333-3333-4333-8333-333333333333",
        bridgeCredentialSecretRef: "arn:secret",
      },
      {
        workflowId: "wf-1",
        workflowName: "Lead enrichment",
        executionId: "exec-1",
        stepId: "recommendation",
        correlationId: "lead-123",
        requestId: "request-1",
        agentId: "44444444-4444-4444-8444-444444444444",
        spaceId: "55555555-5555-4555-8555-555555555555",
        instructions: "Recommend next actions.",
        input: { leadId: "lead-123" },
        metadata: {},
        timeoutSeconds: null,
        resumeUrl: null,
      },
      {
        db: db as never,
        ensureThread,
        now: () => new Date("2026-06-20T12:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      runId: "66666666-6666-4666-8666-666666666666",
      replayed: true,
      wakeupRequestId: null,
      threadId: "88888888-8888-4888-8888-888888888888",
      openingMessageId: "99999999-9999-4999-8999-999999999999",
      expiresAt: "2026-06-21T12:00:00.000Z",
    });
    expect(ensureThread).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
