import { describe, expect, it, vi } from "vitest";
import { startN8nAgentStepRun } from "./start.js";

const AUTH_CONTEXT = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  tenantSlug: "acme",
  pluginInstallId: "22222222-2222-4222-8222-222222222222",
  managedApplicationId: "33333333-3333-4333-8333-333333333333",
  bridgeCredentialSecretRef: "arn:secret",
  n8nPublicUrl: "https://n8n.example.test",
};

const PAYLOAD = {
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
  resumeUrl: {
    href: "https://n8n.example.test/webhook-waiting/resume/abc",
    host: "n8n.example.test",
    origin: "https://n8n.example.test",
    pathname: "/webhook-waiting/resume/abc",
    path: "/webhook-waiting/resume/abc",
  },
};

const RUN_ROW = {
  id: "66666666-6666-4666-8666-666666666666",
  tenant_id: AUTH_CONTEXT.tenantId,
  status: "accepted",
  thread_id: null,
  opening_message_id: null,
  resume_url_secret_ref:
    "thinkwork/dev/n8n-agent-step-runs/acme/idempotency/resume-url",
  resume_url_host: "n8n.example.test",
  resume_url_path: "/webhook-waiting/resume/abc",
  expires_at: new Date("2026-06-21T12:00:00.000Z"),
};

describe("startN8nAgentStepRun", () => {
  it("replays a complete existing idempotency key without creating a thread", async () => {
    const existingRun = {
      ...RUN_ROW,
      status: "waiting",
      thread_id: "88888888-8888-4888-8888-888888888888",
      opening_message_id: "99999999-9999-4999-8999-999999999999",
    };
    const db = queuedDb({
      selectRows: [
        [existingRun],
        [{ id: "77777777-7777-4777-8777-777777777777" }],
      ],
    });
    const ensureThread = vi.fn();

    const result = await startN8nAgentStepRun(AUTH_CONTEXT, PAYLOAD, {
      db: db as never,
      ensureThread,
      now: () => new Date("2026-06-20T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      runId: "66666666-6666-4666-8666-666666666666",
      replayed: true,
      wakeupRequestId: "77777777-7777-4777-8777-777777777777",
      threadId: "88888888-8888-4888-8888-888888888888",
      openingMessageId: "99999999-9999-4999-8999-999999999999",
      expiresAt: "2026-06-21T12:00:00.000Z",
    });
    expect(ensureThread).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("recovers an incomplete idempotency row after a transient side-effect failure", async () => {
    const db = queuedDb({
      selectRows: [
        [],
        [{ id: PAYLOAD.agentId }],
        [{ id: PAYLOAD.spaceId }],
        [RUN_ROW],
        [],
        [{ id: PAYLOAD.agentId }],
        [{ id: PAYLOAD.spaceId }],
        [],
      ],
      insertRows: [
        [RUN_ROW],
        [{ id: "99999999-9999-4999-8999-999999999999" }],
        [{ id: "77777777-7777-4777-8777-777777777777" }],
      ],
      updateRows: [
        [{ ...RUN_ROW, thread_id: "88888888-8888-4888-8888-888888888888" }],
        [
          {
            ...RUN_ROW,
            thread_id: "88888888-8888-4888-8888-888888888888",
            opening_message_id: "99999999-9999-4999-8999-999999999999",
          },
        ],
        [
          {
            ...RUN_ROW,
            status: "waiting",
            thread_id: "88888888-8888-4888-8888-888888888888",
            opening_message_id: "99999999-9999-4999-8999-999999999999",
          },
        ],
      ],
    });
    const secrets = {
      getSecret: vi.fn(),
      putSecret: vi
        .fn()
        .mockRejectedValueOnce(new Error("transient secret write failure"))
        .mockResolvedValueOnce(undefined),
      deleteSecret: vi.fn(),
    };
    const ensureThread = vi.fn(async () => ({
      threadId: "88888888-8888-4888-8888-888888888888",
      identifier: "HOOK-42",
      number: 42,
    }));

    await expect(
      startN8nAgentStepRun(AUTH_CONTEXT, PAYLOAD, {
        db: db as never,
        ensureThread,
        secrets,
        now: () => new Date("2026-06-20T12:00:00.000Z"),
        stage: "dev",
      }),
    ).rejects.toThrow("transient secret write failure");

    const result = await startN8nAgentStepRun(AUTH_CONTEXT, PAYLOAD, {
      db: db as never,
      ensureThread,
      secrets,
      now: () => new Date("2026-06-20T12:00:00.000Z"),
      stage: "dev",
    });

    expect(result).toMatchObject({
      status: "waiting",
      replayed: false,
      wakeupRequestId: "77777777-7777-4777-8777-777777777777",
      threadId: "88888888-8888-4888-8888-888888888888",
      threadIdentifier: "HOOK-42",
      threadNumber: 42,
      openingMessageId: "99999999-9999-4999-8999-999999999999",
    });
    expect(secrets.putSecret).toHaveBeenCalledTimes(2);
    expect(ensureThread).toHaveBeenCalledTimes(1);
  });
});

function queuedDb(input: {
  selectRows?: unknown[][];
  insertRows?: unknown[][];
  updateRows?: unknown[][];
}) {
  const selectRows = [...(input.selectRows ?? [])];
  const insertRows = [...(input.insertRows ?? [])];
  const updateRows = [...(input.updateRows ?? [])];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectRows.shift() ?? []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => insertRows.shift() ?? []),
        })),
        returning: vi.fn(async () => insertRows.shift() ?? []),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => updateRows.shift() ?? []),
        })),
      })),
    })),
  };
}
