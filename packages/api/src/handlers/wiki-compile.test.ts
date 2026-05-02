import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runCompileJob: vi.fn(),
  runJobById: vi.fn(),
  runDraftCompileJob: vi.fn(),
  runDraftCompileJobById: vi.fn(),
  claimNextCompileJob: vi.fn(),
  getCompileJob: vi.fn(),
  writeUserKnowledgePack: vi.fn(),
  loadGooglePlacesClientFromSsm: vi.fn(),
  recordStep: vi.fn(),
  recordEvidence: vi.fn(),
  updateSummary: vi.fn(),
}));

vi.mock("../lib/wiki/compiler.js", () => ({
  runCompileJob: mocks.runCompileJob,
  runJobById: mocks.runJobById,
}));

vi.mock("../lib/wiki/draft-compile.js", () => ({
  runDraftCompileJob: mocks.runDraftCompileJob,
  runDraftCompileJobById: mocks.runDraftCompileJobById,
}));

vi.mock("../lib/wiki/repository.js", () => ({
  claimNextCompileJob: mocks.claimNextCompileJob,
  getCompileJob: mocks.getCompileJob,
}));

vi.mock("../lib/wiki/pack-renderer.js", () => ({
  writeUserKnowledgePack: mocks.writeUserKnowledgePack,
}));

vi.mock("../lib/wiki/google-places-client.js", () => ({
  loadGooglePlacesClientFromSsm: mocks.loadGooglePlacesClientFromSsm,
}));

vi.mock("../lib/system-workflows/wiki-build.js", () => ({
  recordWikiBuildWorkflowStep: mocks.recordStep,
  recordWikiBuildWorkflowEvidence: mocks.recordEvidence,
  updateWikiBuildWorkflowRunSummary: mocks.updateSummary,
}));

import { handler } from "./wiki-compile.js";

const job = {
  id: "job-1",
  tenant_id: "tenant-1",
  owner_id: "owner-1",
  dedupe_key: "tenant-1:owner-1:1",
  status: "pending",
  trigger: "admin",
  attempt: 0,
  claimed_at: null,
  started_at: null,
  finished_at: null,
  error: null,
  metrics: null,
  created_at: new Date("2026-05-02T12:00:00Z"),
};

describe("wiki-compile handler system workflow adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadGooglePlacesClientFromSsm.mockResolvedValue(null);
    mocks.getCompileJob.mockResolvedValue(job);
    mocks.runJobById.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      metrics: { pages_written: 3 },
      error: null,
    });
  });

  it("preserves legacy direct invocation without workflow records", async () => {
    const result = await handler({ jobId: "job-1" });

    expect(result).toMatchObject({
      ok: true,
      jobId: "job-1",
      status: "succeeded",
    });
    expect(mocks.runJobById).toHaveBeenCalledWith("job-1", {
      googlePlacesClient: null,
    });
    expect(mocks.recordStep).not.toHaveBeenCalled();
    expect(mocks.recordEvidence).not.toHaveBeenCalled();
    expect(mocks.updateSummary).not.toHaveBeenCalled();
  });

  it("records workflow steps and evidence when context is present", async () => {
    const result = await handler({
      jobId: "job-1",
      tenantId: "tenant-1",
      ownerId: "owner-1",
      systemWorkflowRunId: "sw-run-1",
      systemWorkflowExecutionArn: "arn:execution",
      trigger: "admin",
    });

    expect(result).toMatchObject({
      ok: true,
      jobId: "job-1",
      status: "succeeded",
    });
    expect(mocks.recordStep).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        runId: "sw-run-1",
        executionArn: "arn:execution",
      },
      expect.objectContaining({
        nodeId: "ClaimCompileJob",
        idempotencyKey: "wiki-build:job-1:claim",
      }),
    );
    expect(mocks.recordStep).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        runId: "sw-run-1",
        executionArn: "arn:execution",
      },
      expect.objectContaining({
        nodeId: "CompilePages",
        status: "succeeded",
        idempotencyKey: "wiki-build:job-1:compile",
      }),
    );
    expect(mocks.recordEvidence).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        runId: "sw-run-1",
        executionArn: "arn:execution",
      },
      expect.objectContaining({
        evidenceType: "compile-summary",
        idempotencyKey: "wiki-build:job-1:compile-summary",
      }),
    );
    expect(mocks.updateSummary).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        runId: "sw-run-1",
        executionArn: "arn:execution",
      },
      expect.objectContaining({
        workflow: "wiki-build",
        jobId: "job-1",
        ok: true,
      }),
    );
  });

  it("returns a failed gate result and evidence for failed compile jobs", async () => {
    mocks.runJobById.mockResolvedValue({
      jobId: "job-1",
      status: "failed",
      metrics: { records_seen: 2 },
      error: "model output invalid",
    });

    const result = await handler({
      jobId: "job-1",
      tenantId: "tenant-1",
      systemWorkflowRunId: "sw-run-1",
    });

    expect(result).toMatchObject({
      ok: false,
      jobId: "job-1",
      status: "failed",
      error: "model output invalid",
    });
    expect(mocks.recordStep).toHaveBeenCalledWith(
      { tenantId: "tenant-1", runId: "sw-run-1", executionArn: null },
      expect.objectContaining({
        nodeId: "ValidateGraph",
        status: "failed",
        idempotencyKey: "wiki-build:job-1:quality-gate",
      }),
    );
    expect(mocks.recordEvidence).toHaveBeenCalledWith(
      { tenantId: "tenant-1", runId: "sw-run-1", executionArn: null },
      expect.objectContaining({
        evidenceType: "quality-gates",
        summary: "Wiki compile status gate failed.",
      }),
    );
  });

  it("treats already-terminal jobs as idempotent success", async () => {
    mocks.getCompileJob.mockResolvedValue({
      ...job,
      status: "succeeded",
    });

    const result = await handler({
      jobId: "job-1",
      tenantId: "tenant-1",
      systemWorkflowRunId: "sw-run-1",
    });

    expect(result).toEqual({
      ok: true,
      jobId: "job-1",
      status: "already_done",
    });
    expect(mocks.runJobById).not.toHaveBeenCalled();
    expect(mocks.recordEvidence).toHaveBeenCalledWith(
      { tenantId: "tenant-1", runId: "sw-run-1", executionArn: null },
      expect.objectContaining({
        evidenceType: "compile-summary",
        summary: "Wiki compile job job-1 already_done.",
      }),
    );
  });
});
