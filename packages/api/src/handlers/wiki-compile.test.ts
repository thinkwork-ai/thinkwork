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
});
