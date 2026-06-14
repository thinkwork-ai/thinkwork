import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  updateSets,
  updateReturningQueue,
  insertValues,
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockDb,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const updateSets: Record<string, unknown>[] = [];
  const updateReturningQueue: unknown[][] = [];
  const insertValues: Record<string, unknown>[] = [];
  const mockRequireTenantAdmin = vi.fn();
  const mockResolveCallerTenantId = vi.fn();
  const mockResolveCallerUserId = vi.fn();
  const mockDb = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
        orderBy: vi.fn(async () => selectQueue.shift() ?? []),
      };
      return chain;
    }),
    update: vi.fn(() => {
      const chain: any = {
        set: vi.fn((value) => {
          updateSets.push(value);
          return chain;
        }),
        where: vi.fn(() => chain),
        returning: vi.fn(async () => updateReturningQueue.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn(() => {
      const chain: any = {
        values: vi.fn((value) => {
          insertValues.push(value);
          return chain;
        }),
        onConflictDoNothing: vi.fn(async () => undefined),
      };
      return chain;
    }),
  };
  return {
    selectQueue,
    updateSets,
    updateReturningQueue,
    insertValues,
    mockRequireTenantAdmin,
    mockResolveCallerTenantId,
    mockResolveCallerUserId,
    mockDb,
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  snakeToCamel: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
        value,
      ]),
    ),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

let queryMod: typeof import("./releaseUpdateJob.query.js");

beforeEach(async () => {
  vi.resetModules();
  selectQueue.length = 0;
  updateSets.length = 0;
  updateReturningQueue.length = 0;
  insertValues.length = 0;
  mockDb.select.mockClear();
  mockDb.update.mockClear();
  mockDb.insert.mockClear();
  mockRequireTenantAdmin.mockReset().mockResolvedValue("owner");
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
  queryMod = await import("./releaseUpdateJob.query.js");
});

describe("release update jobs", () => {
  it("returns a tenant-scoped release update job with ordered events", async () => {
    selectQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        status: "preflight_blocked",
        requested_by_user_id: "user-1",
        target_release_version: "v0.1.0-canary.187",
        current_release_version: "v0.1.0-canary.178",
        manifest_url:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.187/thinkwork-release.json",
        manifest_sha256: "a".repeat(64),
        manifest_signed: false,
        manifest_trust_policy: "allow_unsigned_canary",
        terraform_module_version: "0.1.0-canary.187",
        preflight_summary: { blocked: true },
        preserved_config_summary: { customerDomain: "tei.thinkwork.ai" },
        remediation_summary: { runnerRefresh: "available" },
        evidence_bucket: "thinkwork-tei-e2e-deploy-evidence",
        evidence_prefix: "release-updates/job-1",
        failure_category: "runner_compatibility",
        recovery_action: "Refresh the S3 runner and rerun preflight.",
      },
    ]);
    selectQueue.push([
      {
        id: "event-1",
        tenant_id: "tenant-1",
        job_id: "job-1",
        event_type: "preflight_blocked",
        message: "Runner refresh required.",
        payload: { remediation: "runner_refresh" },
      },
    ]);

    const result = await queryMod.releaseUpdateJob(
      null,
      { jobId: "job-1" },
      {} as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(result).toMatchObject({
      id: "job-1",
      tenantId: "tenant-1",
      targetReleaseVersion: "v0.1.0-canary.187",
      currentReleaseVersion: "v0.1.0-canary.178",
      manifestSha256: "a".repeat(64),
      preflightSummary: { blocked: true },
      preservedConfigSummary: { customerDomain: "tei.thinkwork.ai" },
      remediationSummary: { runnerRefresh: "available" },
      events: [
        {
          id: "event-1",
          jobId: "job-1",
          eventType: "preflight_blocked",
          payload: { remediation: "runner_refresh" },
        },
      ],
    });
  });

  it("returns null when the job is outside the caller tenant", async () => {
    selectQueue.push([]);

    await expect(
      queryMod.releaseUpdateJob(null, { jobId: "other-job" }, {} as any),
    ).resolves.toBeNull();
  });

  it("persists terminal status from the deployment status pointer", async () => {
    const job = {
      id: "job-2",
      tenant_id: "tenant-1",
      status: "updating",
      requested_by_user_id: "user-1",
      target_release_version: "v0.1.0-canary.190",
      current_release_version: "v0.1.0-canary.187",
      manifest_url:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.190/thinkwork-release.json",
      manifest_sha256: "b".repeat(64),
      manifest_signed: true,
      manifest_trust_policy: "require_signature",
      terraform_module_version: "0.1.0-canary.190",
      preflight_summary: { blocked: false },
      preserved_config_summary: { available: true },
      remediation_summary: {},
      state_machine_arn: "arn:sfn:controller",
      execution_arn: "arn:sfn:execution:update",
      evidence_bucket: "evidence-bucket",
      evidence_prefix: "release-updates/job-2/update",
      status_pointer_bucket: "evidence-bucket",
      status_pointer_key: "deployment/status/current.json",
      final_status: {},
    };
    const pointer = {
      status: "failed",
      targetRelease: {
        version: "v0.1.0-canary.190",
        manifestUrl: job.manifest_url,
        manifestSha256: job.manifest_sha256,
      },
      controller: {
        codebuildBuildId: "thinkwork-deploy:build-1",
      },
      error: "terraform apply failed",
      recordedAt: "2026-06-14T21:45:00Z",
    };
    selectQueue.push([job]);
    updateReturningQueue.push([
      {
        ...job,
        status: "failed",
        final_status: pointer,
        codebuild_build_arn: "thinkwork-deploy:build-1",
        failure_category: "deployment_controller_failed",
        failure_message: "terraform apply failed",
        recovery_action:
          "Review the deployment evidence and rerun preflight before retrying.",
      },
    ]);
    selectQueue.push([
      {
        id: "event-2",
        tenant_id: "tenant-1",
        job_id: "job-2",
        event_type: "release_update_failed",
        message: "Release update failed.",
        payload: { statusPointer: pointer },
      },
    ]);

    const result = await queryMod.releaseUpdateJob(
      null,
      { jobId: "job-2" },
      {} as any,
      {
        readStatusPointer: async () => pointer,
      },
    );

    expect(updateSets[0]).toMatchObject({
      status: "failed",
      final_status: pointer,
      codebuild_build_arn: "thinkwork-deploy:build-1",
      failure_category: "deployment_controller_failed",
      failure_message: "terraform apply failed",
    });
    expect(insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      job_id: "job-2",
      event_type: "release_update_failed",
      idempotency_key: "job-2:release-update-failed:2026-06-14T21:45:00Z",
    });
    expect(result).toMatchObject({
      id: "job-2",
      status: "failed",
      failureMessage: "terraform apply failed",
      recoveryAction:
        "Review the deployment evidence and rerun preflight before retrying.",
      finalStatus: pointer,
    });
  });
});
