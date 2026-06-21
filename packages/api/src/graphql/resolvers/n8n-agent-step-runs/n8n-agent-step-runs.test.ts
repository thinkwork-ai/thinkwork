import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectQueue, mockDb, mockResolveCallerTenantId } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockDb = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
      };
      return chain;
    }),
  };
  return {
    selectQueue,
    mockDb,
    mockResolveCallerTenantId: vi.fn(),
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

import { loadN8nAgentStepRunTelemetry, n8nAgentStepRuns } from "./telemetry.js";

const TENANT_ID = "tenant-1";

beforeEach(() => {
  selectQueue.length = 0;
  mockDb.select.mockClear();
  mockResolveCallerTenantId.mockReset().mockResolvedValue(TENANT_ID);
});

describe("n8nAgentStepRuns", () => {
  it("returns redacted bridge telemetry for the caller tenant", async () => {
    selectQueue.push([
      runRow({
        output_payload: { output: "raw output should not leak" },
        result_payload: {
          status: "succeeded",
          output: { secret: "nested raw token" },
          summary: "Order has already shipped",
        },
        summary: "Order has already shipped",
        error_payload: { message: "should prefer explicit error" },
        request_metadata: { authorization: "Bearer secret" },
        resume_url_host: "n8n.example.test",
        resume_url_path: "/webhook-waiting/secret-token",
      }),
    ]);

    const result = await n8nAgentStepRuns(
      null,
      { threadId: "thread-1", limit: 5 },
      { auth: { tenantId: null } } as any,
    );

    expect(mockResolveCallerTenantId).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "run-1",
      status: "waiting",
      resumeStatus: "not_ready",
      workflowName: "Order triage",
      outputPreview: "Order has already shipped",
      errorMessage: "should prefer explicit error",
    });
    expect(JSON.stringify(result[0])).not.toContain(
      "raw output should not leak",
    );
    expect(JSON.stringify(result[0])).not.toContain("nested raw token");
    expect(result[0]).not.toHaveProperty("tenantId");
    expect(result[0]).not.toHaveProperty("idempotencyKey");
    expect(result[0]).not.toHaveProperty("requestMetadata");
    expect(result[0]).not.toHaveProperty("resumeUrlHost");
    expect(result[0]).not.toHaveProperty("resumeUrlPath");
    expect(result[0]).not.toHaveProperty("outputPayload");
    expect(result[0]).not.toHaveProperty("errorPayload");
    expect(result[0]).not.toHaveProperty("resultPayload");
  });

  it("does not read bridge runs when the caller tenant cannot resolve", async () => {
    mockResolveCallerTenantId.mockResolvedValueOnce(null);

    await expect(
      n8nAgentStepRuns(null, { threadId: "thread-1" }, {} as any),
    ).resolves.toEqual([]);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("rejects invalid limits before querying", async () => {
    await expect(
      loadN8nAgentStepRunTelemetry({
        tenantId: TENANT_ID,
        threadId: "thread-1",
        limit: 0,
        db: mockDb as never,
      }),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

function runRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-20T12:00:00.000Z");
  return {
    id: "run-1",
    tenant_id: TENANT_ID,
    plugin_install_id: "install-1",
    managed_application_id: "app-n8n",
    space_id: "space-1",
    agent_id: "agent-1",
    thread_id: "thread-1",
    thread_turn_id: "turn-1",
    opening_message_id: "message-1",
    status: "waiting",
    resume_status: "not_ready",
    workflow_id: "workflow-1",
    workflow_name: "Order triage",
    execution_id: "execution-1",
    step_id: "agent-step",
    correlation_id: "corr-1",
    request_id: "request-1",
    idempotency_key: "idempotency-secret",
    instructions_preview: "Investigate the order",
    input_preview: '{"orderId":"123"}',
    request_metadata: {},
    resume_url_secret_ref: "secret-ref",
    resume_url_host: "n8n.example.test",
    resume_url_path: "/webhook-waiting/token",
    timeout_seconds: 3600,
    expires_at: now,
    result_payload: null,
    output_payload: null,
    error_payload: null,
    summary: null,
    links: { threadUrl: "/threads/thread-1" },
    resume_attempt_count: 0,
    next_resume_attempt_at: null,
    last_resume_attempt_at: null,
    last_resume_http_status: null,
    last_resume_error: null,
    resumed_at: null,
    terminal_at: null,
    accepted_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
