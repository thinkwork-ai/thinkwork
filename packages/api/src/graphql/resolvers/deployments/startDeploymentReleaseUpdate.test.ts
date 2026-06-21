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
  mockStartExecution,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const updateSets: Record<string, unknown>[] = [];
  const updateReturningQueue: unknown[][] = [];
  const insertValues: Record<string, unknown>[] = [];
  const mockRequireTenantAdmin = vi.fn();
  const mockResolveCallerTenantId = vi.fn();
  const mockResolveCallerUserId = vi.fn();
  const mockStartExecution = vi.fn();
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
    mockStartExecution,
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

let mutationMod: typeof import("./startDeploymentReleaseUpdate.mutation.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
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
  mockStartExecution.mockReset().mockResolvedValue({
    executionArn: "arn:sfn:execution:update",
    stateMachineArn: "arn:sfn:controller",
  });
  mutationMod = await import("./startDeploymentReleaseUpdate.mutation.js");
});

describe("startDeploymentReleaseUpdate", () => {
  it("dispatches only a reviewed preflight job and preserves customer config", async () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");
    const job = releaseJob({
      status: "runner_remediated",
      preflight_summary: {
        blocked: false,
        blockers: [],
        manifest: {
          signatureUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.187/thinkwork-release.json.sig",
        },
      },
      preserved_config_summary: {
        available: true,
        fields: {
          customerDomain: "customer.example.com",
          customerDomainDelegated: true,
          customerDomainLegacyRetired: false,
          platformOperatorEmails: "ops@example.com",
          sesSender: {
            cognitoEmailSourceArn:
              "arn:aws:ses:us-east-1:123456789012:identity/customer.example.com",
            cognitoFromEmailAddress: "ThinkWork <noreply@example.com>",
            cognitoReplyToEmailAddress: "help@example.com",
          },
          optionalApps: {
            hindsight: true,
            cognee: true,
            twenty: false,
            n8n: true,
          },
        },
      },
    });
    const updated = {
      ...job,
      status: "updating",
      execution_arn: "arn:sfn:execution:update",
      evidence_bucket: "controller-evidence",
      evidence_prefix: `release-updates/${job.id}/update`,
    };
    selectQueue.push([job]);
    updateReturningQueue.push([updated]);
    selectQueue.push([
      {
        id: "event-1",
        job_id: job.id,
        event_type: "release_update_dispatched",
        payload: {},
      },
    ]);

    const result = await mutationMod.startDeploymentReleaseUpdate(
      null,
      { input: { jobId: job.id, idempotencyKey: "dispatch-1" } },
      {} as any,
      {
        startExecution: mockStartExecution,
        resolveDeploymentControllerConfig: async () => ({
          stateMachineArn: "arn:sfn:controller",
          evidenceBucket: "controller-evidence",
        }),
      },
    );

    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stateMachineArn: "arn:sfn:controller",
        name: "tw-update-11111111222233334444555555555555",
        payload: expect.objectContaining({
          phase: "update",
          action: "update",
          tenantId: "tenant-1",
          jobId: job.id,
          release: expect.objectContaining({
            version: "v0.1.0-canary.187",
            manifestSha256: "a".repeat(64),
            manifestSignatureUrl:
              "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.187/thinkwork-release.json.sig",
          }),
          preservedConfig: expect.objectContaining({
            customerDomain: "customer.example.com",
            customerDomainDelegated: true,
            platformOperatorEmails: "ops@example.com",
            cognitoReplyToEmailAddress: "help@example.com",
            enableHindsight: true,
            enableCognee: true,
            n8nProvisioned: true,
          }),
          features: expect.objectContaining({
            optionalApps: expect.arrayContaining(["cognee", "n8n"]),
          }),
          customerDomain: "customer.example.com",
          cognitoFromEmailAddress: "ThinkWork <noreply@example.com>",
        }),
      }),
    );
    expect(updateSets[0]).toMatchObject({
      status: "updating",
      state_machine_arn: "arn:sfn:controller",
      execution_arn: "arn:sfn:execution:update",
      evidence_bucket: "controller-evidence",
      evidence_prefix: `release-updates/${job.id}/update`,
    });
    expect(insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      job_id: job.id,
      event_type: "release_update_dispatched",
      idempotency_key: "dispatch-1",
    });
    expect(result).toMatchObject({
      id: job.id,
      status: "updating",
      executionArn: "arn:sfn:execution:update",
      evidencePrefix: `release-updates/${job.id}/update`,
    });
  });

  it("blocks dispatch when preflight is not ready", async () => {
    const job = releaseJob({
      status: "preflight_blocked",
      preflight_summary: {
        blocked: true,
        blockers: [{ category: "runner_compatibility" }],
      },
    });
    selectQueue.push([job]);

    await expect(
      mutationMod.startDeploymentReleaseUpdate(
        null,
        { input: { jobId: job.id } },
        {} as any,
        { startExecution: mockStartExecution },
      ),
    ).rejects.toThrow(/preflight is not ready/i);

    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

function releaseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    tenant_id: "tenant-1",
    status: "preflight_ready",
    idempotency_key: "preflight-1",
    requested_by_user_id: "user-1",
    target_release_version: "v0.1.0-canary.187",
    current_release_version: "v0.1.0-canary.178",
    manifest_url:
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.187/thinkwork-release.json",
    manifest_sha256: "a".repeat(64),
    manifest_signed: true,
    manifest_trust_policy: "require_signature",
    terraform_module_version: "0.1.0-canary.187",
    preflight_summary: { blocked: false, blockers: [] },
    preserved_config_summary: { available: true, fields: {} },
    remediation_summary: {},
    state_machine_arn: "arn:sfn:controller",
    execution_arn: null,
    codebuild_build_arn: null,
    evidence_bucket: "evidence-bucket",
    evidence_prefix: "release-updates/job/preflight",
    status_pointer_bucket: "evidence-bucket",
    status_pointer_key: "deployment/status/current.json",
    final_status: {},
    failure_category: null,
    failure_message: null,
    recovery_action: null,
    created_at: new Date("2026-06-14T00:00:00Z"),
    updated_at: new Date("2026-06-14T00:00:00Z"),
    ...overrides,
  };
}
