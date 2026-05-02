import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordStep: vi.fn(),
  recordEvidence: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));

vi.mock("./events.js", () => ({
  recordSystemWorkflowStepEvent: mocks.recordStep,
}));

vi.mock("./evidence.js", () => ({
  recordSystemWorkflowEvidence: mocks.recordEvidence,
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: mocks.update,
  }),
}));

import {
  recordActivationWorkflowEvidence,
  recordActivationWorkflowStep,
  updateActivationWorkflowRunSummary,
} from "./activation.js";

describe("activation system workflow helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.where.mockResolvedValue([]);
  });

  it("records activation step events with workflow context", async () => {
    const startedAt = new Date("2026-05-02T12:00:00Z");
    const finishedAt = new Date("2026-05-02T12:01:00Z");

    await recordActivationWorkflowStep(
      { tenantId: "tenant-1", runId: "run-1" },
      {
        nodeId: "TrackReadiness",
        stepType: "checkpoint",
        status: "succeeded",
        startedAt,
        finishedAt,
        outputJson: { sessionId: "session-1", completedLayers: 2 },
        idempotencyKey: "activation:session-1:readiness",
      },
    );

    expect(mocks.recordStep).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      runId: "run-1",
      nodeId: "TrackReadiness",
      stepType: "checkpoint",
      status: "succeeded",
      startedAt,
      finishedAt,
      inputJson: undefined,
      outputJson: { sessionId: "session-1", completedLayers: 2 },
      errorJson: undefined,
      idempotencyKey: "activation:session-1:readiness",
    });
  });

  it("records activation evidence with compact summaries", async () => {
    await recordActivationWorkflowEvidence(
      { tenantId: "tenant-1", runId: "run-1" },
      {
        evidenceType: "activation-timeline",
        title: "Activation timeline",
        summary: "Activation session session-1 is ready_for_review.",
        artifactJson: { sessionId: "session-1", status: "ready_for_review" },
        complianceTags: ["activation", "launch-readiness"],
        idempotencyKey: "activation:session-1:timeline",
      },
    );

    expect(mocks.recordEvidence).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      runId: "run-1",
      evidenceType: "activation-timeline",
      title: "Activation timeline",
      summary: "Activation session session-1 is ready_for_review.",
      artifactJson: { sessionId: "session-1", status: "ready_for_review" },
      artifactUri: undefined,
      complianceTags: ["activation", "launch-readiness"],
      idempotencyKey: "activation:session-1:timeline",
    });
  });

  it("no-ops when workflow context is absent", async () => {
    await recordActivationWorkflowStep(null, {
      nodeId: "TrackReadiness",
      stepType: "checkpoint",
      status: "succeeded",
      idempotencyKey: "activation:session-1:readiness",
    });
    await recordActivationWorkflowEvidence(undefined, {
      evidenceType: "activation-timeline",
      title: "Activation timeline",
      idempotencyKey: "activation:session-1:timeline",
    });
    await updateActivationWorkflowRunSummary(null, { ok: true });

    expect(mocks.recordStep).not.toHaveBeenCalled();
    expect(mocks.recordEvidence).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates workflow run summaries", async () => {
    await updateActivationWorkflowRunSummary(
      { tenantId: "tenant-1", runId: "run-1" },
      {
        workflow: "tenant-agent-activation",
        sessionId: "session-1",
        status: "ready_for_review",
        totalCostUsdCents: 0,
      },
    );

    expect(mocks.set).toHaveBeenCalledWith({
      evidence_summary_json: {
        workflow: "tenant-agent-activation",
        sessionId: "session-1",
        status: "ready_for_review",
        totalCostUsdCents: 0,
      },
      total_cost_usd_cents: 0,
    });
    expect(mocks.where).toHaveBeenCalledOnce();
  });
});
