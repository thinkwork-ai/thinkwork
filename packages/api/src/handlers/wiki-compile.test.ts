/**
 * wiki-compile handler tests — graph-only since the U11 cutover (plan
 * 2026-06-09-004): every invocation dispatches to the graph→wiki
 * materializer; the planner pipeline (compiler, draft-compile, Google
 * Places priming, per-user knowledge packs) no longer exists.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runGraphCompileJobById: vi.fn(),
  runNextGraphCompileJob: vi.fn(),
  getCompileJob: vi.fn(),
}));

vi.mock("../lib/wiki/graph-materializer.js", () => ({
  runGraphCompileJobById: mocks.runGraphCompileJobById,
  runNextGraphCompileJob: mocks.runNextGraphCompileJob,
}));

vi.mock("../lib/wiki/repository.js", () => ({
  getCompileJob: mocks.getCompileJob,
}));

import { handler } from "./wiki-compile.js";

const tenantJob = {
  id: "job-1",
  tenant_id: "tenant-1",
  owner_id: null,
  dedupe_key: "graph:obs:tenant-1:5601200",
  status: "pending",
  trigger: "graph_materialize",
  attempt: 0,
  claimed_at: null,
  started_at: null,
  finished_at: null,
  error: null,
  metrics: null,
  created_at: new Date("2026-05-02T12:00:00Z"),
};

describe("wiki-compile handler (graph-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCompileJob.mockResolvedValue(tenantJob);
    mocks.runGraphCompileJobById.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      metrics: { pages_upserted: 2 },
    });
    mocks.runNextGraphCompileJob.mockResolvedValue({
      jobId: "job-2",
      status: "succeeded",
      metrics: { pages_upserted: 1 },
    });
  });

  it("routes id-targeted invocations to the materializer", async () => {
    const result = await handler({ jobId: "job-1" });

    expect(result).toMatchObject({
      ok: true,
      jobId: "job-1",
      status: "succeeded",
      metrics: { pages_upserted: 2 },
    });
    expect(mocks.runGraphCompileJobById).toHaveBeenCalledWith("job-1");
  });

  it("ignores the legacy planner-era modelId payload field", async () => {
    const result = await handler({ jobId: "job-1", modelId: "some-model" });

    expect(result).toMatchObject({ ok: true, status: "succeeded" });
    expect(mocks.runGraphCompileJobById).toHaveBeenCalledWith("job-1");
  });

  it("routes queue-drain invocations to the materializer", async () => {
    const result = await handler({});

    expect(result).toMatchObject({
      ok: true,
      jobId: "job-2",
      status: "succeeded",
    });
    expect(mocks.runNextGraphCompileJob).toHaveBeenCalled();
    expect(mocks.runGraphCompileJobById).not.toHaveBeenCalled();
  });

  it("returns no_job when the queue is empty", async () => {
    mocks.runNextGraphCompileJob.mockResolvedValue(null);
    expect(await handler({})).toEqual({ ok: true, status: "no_job" });
  });

  it("treats terminal jobs as idempotent success without invoking the materializer", async () => {
    mocks.getCompileJob.mockResolvedValue({
      ...tenantJob,
      status: "succeeded",
    });

    const result = await handler({ jobId: "job-1" });

    expect(result).toEqual({
      ok: true,
      jobId: "job-1",
      status: "already_done",
    });
    expect(mocks.runGraphCompileJobById).not.toHaveBeenCalled();
  });

  it("does not redrive an id-targeted job when the CAS claim loses", async () => {
    mocks.runGraphCompileJobById.mockResolvedValue(null);

    const result = await handler({ jobId: "job-1" });

    expect(result).toEqual({
      ok: true,
      jobId: "job-1",
      status: "already_done",
    });
  });

  it("reports skipped residual owner-scoped jobs as ok", async () => {
    mocks.getCompileJob.mockResolvedValue({ ...tenantJob, owner_id: "u-1" });
    mocks.runGraphCompileJobById.mockResolvedValue({
      jobId: "job-1",
      status: "skipped",
    });

    const result = await handler({ jobId: "job-1" });

    expect(result).toMatchObject({
      ok: true,
      jobId: "job-1",
      status: "skipped",
    });
  });

  it("surfaces materializer failures as ok:false", async () => {
    mocks.runGraphCompileJobById.mockResolvedValue({
      jobId: "job-1",
      status: "failed",
      error: "mirror unavailable",
    });

    const result = await handler({ jobId: "job-1" });

    expect(result).toMatchObject({
      ok: false,
      jobId: "job-1",
      status: "failed",
      error: "mirror unavailable",
    });
  });

  it("never throws — unexpected errors return ok:false", async () => {
    mocks.getCompileJob.mockRejectedValue(new Error("db down"));

    const result = await handler({ jobId: "job-1" });

    expect(result).toEqual({ ok: false, error: "db down" });
  });
});
