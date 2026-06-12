import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runCompileJob: vi.fn(),
  runJobById: vi.fn(),
  runDraftCompileJob: vi.fn(),
  runDraftCompileJobById: vi.fn(),
  runGraphCompileJobById: vi.fn(),
  runNextGraphCompileJob: vi.fn(),
  claimNextCompileJob: vi.fn(),
  getCompileJob: vi.fn(),
  writeUserKnowledgePack: vi.fn(),
  loadGooglePlacesClientFromSsm: vi.fn(),
}));

vi.mock("../lib/wiki/compiler.js", () => ({
  runCompileJob: mocks.runCompileJob,
  runJobById: mocks.runJobById,
}));

vi.mock("../lib/wiki/draft-compile.js", () => ({
  runDraftCompileJob: mocks.runDraftCompileJob,
  runDraftCompileJobById: mocks.runDraftCompileJobById,
}));

vi.mock("../lib/wiki/graph-materializer.js", () => ({
  runGraphCompileJobById: mocks.runGraphCompileJobById,
  runNextGraphCompileJob: mocks.runNextGraphCompileJob,
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

describe("wiki-compile handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WIKI_SOURCE;
    mocks.loadGooglePlacesClientFromSsm.mockResolvedValue(null);
    mocks.getCompileJob.mockResolvedValue(job);
    mocks.runJobById.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      metrics: { pages_written: 3 },
      error: null,
    });
  });

  it("runs the compile job by id and returns succeeded", async () => {
    const result = await handler({ jobId: "job-1" });

    expect(result).toMatchObject({
      ok: true,
      jobId: "job-1",
      status: "succeeded",
    });
    expect(mocks.runJobById).toHaveBeenCalledWith("job-1", {
      googlePlacesClient: null,
    });
  });

  it("returns failed result with error when compile fails", async () => {
    mocks.runJobById.mockResolvedValue({
      jobId: "job-1",
      status: "failed",
      metrics: { records_seen: 2 },
      error: "model output invalid",
    });

    const result = await handler({ jobId: "job-1" });

    expect(result).toMatchObject({
      ok: false,
      jobId: "job-1",
      status: "failed",
      error: "model output invalid",
    });
  });

  it("treats already-terminal jobs as idempotent success", async () => {
    mocks.getCompileJob.mockResolvedValue({
      ...job,
      status: "succeeded",
    });

    const result = await handler({ jobId: "job-1" });

    expect(result).toEqual({
      ok: true,
      jobId: "job-1",
      status: "already_done",
    });
    expect(mocks.runJobById).not.toHaveBeenCalled();
  });

  it("does not redrive an id-targeted job when the CAS claim loses", async () => {
    mocks.runJobById.mockResolvedValue(null);

    const result = await handler({ jobId: "job-1" });

    expect(result).toEqual({
      ok: true,
      jobId: "job-1",
      status: "already_done",
    });
    expect(mocks.writeUserKnowledgePack).not.toHaveBeenCalled();
  });

  it("never invokes the graph materializer when WIKI_SOURCE is 'planner'", async () => {
    process.env.WIKI_SOURCE = "planner";

    await handler({ jobId: "job-1" });

    expect(mocks.runJobById).toHaveBeenCalled();
    expect(mocks.runGraphCompileJobById).not.toHaveBeenCalled();
    expect(mocks.runNextGraphCompileJob).not.toHaveBeenCalled();
  });
});

describe("wiki-compile handler — WIKI_SOURCE=graph dispatch", () => {
  const tenantJob = {
    ...job,
    owner_id: null,
    dedupe_key: "graph:obs:tenant-1:5601200",
    trigger: "graph_materialize",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WIKI_SOURCE = "graph";
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

  afterEach(() => {
    delete process.env.WIKI_SOURCE;
  });

  it("routes id-targeted invocations to the materializer and never the planner", async () => {
    const result = await handler({ jobId: "job-1" });

    expect(result).toMatchObject({
      ok: true,
      jobId: "job-1",
      status: "succeeded",
    });
    expect(mocks.runGraphCompileJobById).toHaveBeenCalledWith("job-1");
    // Planner pipeline fully bypassed: no compile, no draft, no claim, no
    // Google Places priming, no per-user knowledge pack.
    expect(mocks.runJobById).not.toHaveBeenCalled();
    expect(mocks.runCompileJob).not.toHaveBeenCalled();
    expect(mocks.runDraftCompileJobById).not.toHaveBeenCalled();
    expect(mocks.claimNextCompileJob).not.toHaveBeenCalled();
    expect(mocks.loadGooglePlacesClientFromSsm).not.toHaveBeenCalled();
    expect(mocks.writeUserKnowledgePack).not.toHaveBeenCalled();
  });

  it("routes queue-drain invocations to the materializer", async () => {
    const result = await handler({});

    expect(result).toMatchObject({
      ok: true,
      jobId: "job-2",
      status: "succeeded",
    });
    expect(mocks.runNextGraphCompileJob).toHaveBeenCalled();
    expect(mocks.runCompileJob).not.toHaveBeenCalled();
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
});
