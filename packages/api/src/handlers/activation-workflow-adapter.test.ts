import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as Record<string, any> | null,
  outboxRows: [] as Array<Record<string, any>>,
  selectCount: 0,
  recordStep: vi.fn(),
  recordEvidence: vi.fn(),
  updateSummary: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => {
      mocks.selectCount += 1;
      const call = mocks.selectCount;
      return {
        from: () => ({
          where: () =>
            call === 1
              ? {
                  limit: async () => (mocks.session ? [mocks.session] : []),
                }
              : Promise.resolve(mocks.outboxRows),
        }),
      };
    },
  }),
}));

vi.mock("../lib/system-workflows/activation.js", () => ({
  recordActivationWorkflowStep: mocks.recordStep,
  recordActivationWorkflowEvidence: mocks.recordEvidence,
  updateActivationWorkflowRunSummary: mocks.updateSummary,
}));

import { handler } from "./activation-workflow-adapter.js";

const baseSession = {
  id: "session-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  mode: "full",
  focus_layer: null,
  current_layer: "knowledge",
  layer_states: {
    rhythms: { ok: true },
    decisions: { ok: true },
  },
  status: "ready_for_review",
};

describe("activation-workflow-adapter handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { ...baseSession };
    mocks.outboxRows = [];
    mocks.selectCount = 0;
  });

  it("records activation workflow evidence for a valid session", async () => {
    mocks.outboxRows = [
      { status: "pending" },
      { status: "completed" },
      { status: "completed" },
    ];

    const result = await handler({
      activationSessionId: "session-1",
      tenantId: "tenant-1",
      userId: "user-1",
      mode: "full",
      currentLayer: "knowledge",
      systemWorkflowRunId: "sw-run-1",
      systemWorkflowExecutionArn: "arn:execution",
      policy: {
        securityAttestationRequired: true,
        launchApprovalRole: "admin",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      sessionId: "session-1",
      status: "ready_for_review",
      launchReady: true,
    });
    expect(mocks.recordStep).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        runId: "sw-run-1",
        executionArn: "arn:execution",
      },
      expect.objectContaining({
        nodeId: "TrackReadiness",
        status: "succeeded",
        idempotencyKey: "activation:session-1:readiness",
      }),
    );
    expect(mocks.recordEvidence).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        runId: "sw-run-1",
        executionArn: "arn:execution",
      },
      expect.objectContaining({
        evidenceType: "activation-timeline",
        idempotencyKey: "activation:session-1:timeline",
      }),
    );
    expect(mocks.updateSummary).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        runId: "sw-run-1",
        executionArn: "arn:execution",
      },
      expect.objectContaining({
        workflow: "tenant-agent-activation",
        ok: true,
        sessionId: "session-1",
        pendingApplyItems: 1,
      }),
    );
  });

  it("returns ok false for missing sessions", async () => {
    mocks.session = null;

    const result = await handler({
      activationSessionId: "missing-session",
      tenantId: "tenant-1",
      systemWorkflowRunId: "sw-run-1",
    });

    expect(result).toEqual({
      ok: false,
      sessionId: "missing-session",
      error: "Activation session not found",
    });
    expect(mocks.recordStep).toHaveBeenCalledWith(
      { tenantId: "tenant-1", runId: "sw-run-1", executionArn: null },
      expect.objectContaining({
        status: "failed",
        idempotencyKey: "activation:missing-session:failure",
      }),
    );
    expect(mocks.recordEvidence).not.toHaveBeenCalled();
  });

  it("does not write success evidence on tenant mismatch", async () => {
    const result = await handler({
      activationSessionId: "session-1",
      tenantId: "other-tenant",
      userId: "user-1",
      systemWorkflowRunId: "sw-run-1",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "Tenant mismatch for activation session",
    });
    expect(mocks.recordEvidence).not.toHaveBeenCalled();
  });

  it("summarizes empty layer state without embedding content", async () => {
    mocks.session = {
      ...baseSession,
      layer_states: {},
      status: "in_progress",
    };

    const result = await handler({
      activationSessionId: "session-1",
      tenantId: "tenant-1",
      userId: "user-1",
      systemWorkflowRunId: "sw-run-1",
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      completedLayerCount: 0,
      completedLayerIds: [],
      status: "in_progress",
    });
  });
});
