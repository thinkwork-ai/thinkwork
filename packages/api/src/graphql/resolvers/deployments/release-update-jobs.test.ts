import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockDb,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
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
  };
  return {
    selectQueue,
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
  mockDb.select.mockClear();
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
});
