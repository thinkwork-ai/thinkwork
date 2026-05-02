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
  recordWikiBuildWorkflowEvidence,
  recordWikiBuildWorkflowStep,
  updateWikiBuildWorkflowRunSummary,
} from "./wiki-build.js";

describe("wiki-build system workflow helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.where.mockResolvedValue([]);
  });

  it("records wiki-build step events with workflow context", async () => {
    const startedAt = new Date("2026-05-02T12:00:00Z");
    const finishedAt = new Date("2026-05-02T12:01:00Z");

    await recordWikiBuildWorkflowStep(
      { tenantId: "tenant-1", runId: "run-1" },
      {
        nodeId: "CompilePages",
        stepType: "worker",
        status: "succeeded",
        startedAt,
        finishedAt,
        outputJson: { jobId: "job-1" },
        idempotencyKey: "wiki:job-1:compile",
      },
    );

    expect(mocks.recordStep).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      runId: "run-1",
      nodeId: "CompilePages",
      stepType: "worker",
      status: "succeeded",
      startedAt,
      finishedAt,
      inputJson: undefined,
      outputJson: { jobId: "job-1" },
      errorJson: undefined,
      idempotencyKey: "wiki:job-1:compile",
    });
  });

  it("records wiki-build evidence with domain summaries", async () => {
    await recordWikiBuildWorkflowEvidence(
      { tenantId: "tenant-1", runId: "run-1" },
      {
        evidenceType: "compile-summary",
        title: "Wiki compile summary",
        summary: "Compile job job-1 succeeded.",
        artifactJson: { jobId: "job-1", status: "succeeded" },
        complianceTags: ["wiki", "knowledge"],
        idempotencyKey: "wiki:job-1:evidence",
      },
    );

    expect(mocks.recordEvidence).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      runId: "run-1",
      evidenceType: "compile-summary",
      title: "Wiki compile summary",
      summary: "Compile job job-1 succeeded.",
      artifactJson: { jobId: "job-1", status: "succeeded" },
      artifactUri: undefined,
      complianceTags: ["wiki", "knowledge"],
      idempotencyKey: "wiki:job-1:evidence",
    });
  });

  it("no-ops when workflow context is absent", async () => {
    await recordWikiBuildWorkflowStep(null, {
      nodeId: "CompilePages",
      stepType: "worker",
      status: "succeeded",
      idempotencyKey: "wiki:job-1:compile",
    });
    await recordWikiBuildWorkflowEvidence(undefined, {
      evidenceType: "compile-summary",
      title: "Wiki compile summary",
      idempotencyKey: "wiki:job-1:evidence",
    });
    await updateWikiBuildWorkflowRunSummary(null, { ok: true });

    expect(mocks.recordStep).not.toHaveBeenCalled();
    expect(mocks.recordEvidence).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates workflow run summaries", async () => {
    await updateWikiBuildWorkflowRunSummary(
      { tenantId: "tenant-1", runId: "run-1" },
      { jobId: "job-1", status: "succeeded", totalCostUsdCents: 42 },
    );

    expect(mocks.set).toHaveBeenCalledWith({
      evidence_summary_json: {
        jobId: "job-1",
        status: "succeeded",
        totalCostUsdCents: 42,
      },
      total_cost_usd_cents: 42,
    });
    expect(mocks.where).toHaveBeenCalledOnce();
  });
});
