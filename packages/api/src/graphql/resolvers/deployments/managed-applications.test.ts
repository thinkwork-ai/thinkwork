import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  releaseManifestSha256,
  type ThinkWorkReleaseManifest,
} from "@thinkwork/release-manifest";

const {
  selectQueue,
  returningQueue,
  insertCalls,
  updateCalls,
  mockStartExecution,
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockRandomUUID,
  mockDb,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const returningQueue: unknown[][] = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const mockStartExecution = vi.fn();
  const mockRequireTenantAdmin = vi.fn();
  const mockResolveCallerTenantId = vi.fn();
  const mockResolveCallerUserId = vi.fn();
  const mockRandomUUID = vi.fn();
  const mockDb = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
        orderBy: vi.fn(async () => selectQueue.shift() ?? []),
        then: (resolve: (value: unknown[]) => void) =>
          resolve(selectQueue.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push(values);
        return {
          returning: async () => returningQueue.shift() ?? [],
          onConflictDoNothing: async () => [],
          then: (resolve: (value: unknown[]) => void) => resolve([]),
        };
      },
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push(values);
        return {
          where: () => ({
            returning: async () => returningQueue.shift() ?? [],
            then: (resolve: (value: unknown[]) => void) => resolve([]),
          }),
        };
      },
    })),
  };
  return {
    selectQueue,
    returningQueue,
    insertCalls,
    updateCalls,
    mockStartExecution,
    mockRequireTenantAdmin,
    mockResolveCallerTenantId,
    mockResolveCallerUserId,
    mockRandomUUID,
    mockDb,
  };
});

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: mockRandomUUID,
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

let startMod: typeof import("./startManagedApplicationPlan.mutation.js");
let sharedMod: typeof import("./shared.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv("STAGE", "");
  vi.stubEnv("THINKWORK_STAGE", "");
  selectQueue.length = 0;
  returningQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  mockStartExecution.mockReset();
  mockRequireTenantAdmin.mockReset().mockResolvedValue("owner");
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mockRandomUUID.mockReset().mockReturnValue("job-1");
  startMod = await import("./startManagedApplicationPlan.mutation.js");
  sharedMod = await import("./shared.js");
});

describe("managed application plan jobs", () => {
  it("keeps plugin-owned adapters out of the operator catalog while allowing internal deployment", () => {
    expect(sharedMod.MANAGED_APP_CATALOG.map((app) => app.key)).toEqual([
      "cognee",
      "twenty",
    ]);
    expect(sharedMod.normalizeManagedAppKey("plane")).toBe("plane");
  });

  it("creates a Cognee plan job, records release metadata, and starts Step Functions", async () => {
    vi.stubEnv("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN", "arn:sfn:deployments");
    vi.stubEnv("THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET", "evidence-bucket");
    selectQueue.push([]); // idempotency lookup
    selectQueue.push([]); // managed application lookup
    returningQueue.push([{ id: "app-1" }]);
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "cognee",
        operation: "ENABLE",
        status: "planning",
        release_version: "1.2.3",
        manifest_digest: "a".repeat(64),
      },
    ]);
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:plan",
      stateMachineArn: "arn:sfn:deployments",
    });
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "cognee",
        operation: "ENABLE",
        status: "planning",
        release_version: "1.2.3",
        manifest_digest: "a".repeat(64),
        plan_execution_arn: "arn:sfn:execution:plan",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "plan_requested" }]);

    const result = await startMod.startManagedApplicationPlan(
      null,
      {
        input: {
          key: "knowledge-graph",
          operation: "ENABLE",
          releaseVersion: "1.2.3",
          manifestUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/thinkwork-release.json",
          manifestDigest: "a".repeat(64),
          manifestImages: JSON.stringify({
            cognee: `public.ecr.aws/thinkwork/cognee@sha256:${"1".repeat(64)}`,
          }),
          desiredConfig: '{"region":"us-east-1"}',
          idempotencyKey: "idem-1",
        },
      },
      {} as any,
      {
        startExecution: mockStartExecution,
        resolveDeploymentControllerConfig: async () => ({
          stateMachineArn: "arn:sfn:deployments",
          evidenceBucket: "evidence-bucket",
          customerDomain: "tei.thinkwork.ai",
          customerDomainDelegated: true,
          customerDomainLegacyRetired: false,
          appCertificateArn: "arn:aws:acm:us-east-1:123:certificate/app",
        }),
      },
    );

    expect(mockRequireTenantAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartExecution.mock.invocationCallOrder[0],
    );
    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stateMachineArn: "arn:sfn:deployments",
        payload: expect.objectContaining({
          schemaVersion: 1,
          contract: "thinkwork.deployment.controller.v1",
          tenantId: "tenant-1",
          jobId: "job-1",
          appKey: "cognee",
          operation: "ENABLE",
          manifestDigest: "a".repeat(64),
          release: expect.objectContaining({
            version: "1.2.3",
            manifestSha256: "a".repeat(64),
          }),
          releaseManifestUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/thinkwork-release.json",
          customerDomain: "tei.thinkwork.ai",
          customerDomainDelegated: true,
          customerDomainLegacyRetired: false,
          appCertificateArn: "arn:aws:acm:us-east-1:123:certificate/app",
          evidence: expect.objectContaining({
            bucket: "evidence-bucket",
            prefix: "tenant-1/cognee/job-1/plan",
          }),
          features: expect.objectContaining({
            optionalApps: ["cognee"],
          }),
          manifestImages: {
            cognee: `public.ecr.aws/thinkwork/cognee@sha256:${"1".repeat(64)}`,
          },
        }),
      }),
    );
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: "tenant-1",
          app_key: "cognee",
          idempotency_key: "idem-1",
          evidence_bucket: "evidence-bucket",
          evidence_prefix: "tenant-1/cognee/job-1/plan",
          plan_summary: expect.objectContaining({
            releaseManifestUrl:
              "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/thinkwork-release.json",
            desiredConfig: { region: "us-east-1" },
            manifestImages: {
              cognee: `public.ecr.aws/thinkwork/cognee@sha256:${"1".repeat(64)}`,
            },
          }),
        }),
      ]),
    );
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ last_job_id: "job-1" }),
        expect.objectContaining({
          plan_execution_arn: "arn:sfn:execution:plan",
        }),
      ]),
    );
    expect(result.planExecutionArn).toBe("arn:sfn:execution:plan");
  });

  it("returns an existing idempotent job without starting a second execution", async () => {
    selectQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "twenty",
        operation: "DESTROY",
        status: "awaiting_approval",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "plan_ready" }]);

    const result = await startMod.startManagedApplicationPlan(
      null,
      {
        input: {
          key: "twenty",
          operation: "DESTROY",
          idempotencyKey: "idem-1",
        },
      },
      {} as any,
      { startExecution: mockStartExecution },
    );

    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(result.status).toBe("awaiting_approval");
  });

  it("rejects unresolved release metadata before creating a deployment job", async () => {
    selectQueue.push([]); // idempotency lookup

    await expect(
      startMod.startManagedApplicationPlan(
        null,
        {
          input: {
            key: "twenty",
            operation: "ENABLE",
            idempotencyKey: "idem-1",
          },
        },
        {} as any,
        { startExecution: mockStartExecution },
      ),
    ).rejects.toThrow(
      'Cannot start a ENABLE deployment job for twenty: release is unresolved (releaseVersion="unresolved", manifestDigest="unresolved"). Resolve a real release before creating the job.',
    );

    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("uses Lambda release metadata defaults when UI omits release fields", async () => {
    vi.stubEnv("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN", "arn:sfn:deployments");
    vi.stubEnv("THINKWORK_RELEASE_VERSION", "2.0.0");
    vi.stubEnv("THINKWORK_RELEASE_MANIFEST_SHA256", "b".repeat(64));
    vi.stubEnv(
      "THINKWORK_RELEASE_MANIFEST_URL",
      "https://example.com/releases/2.0.0/manifest.json",
    );
    selectQueue.push([]); // idempotency lookup
    selectQueue.push([]); // managed application lookup
    returningQueue.push([{ id: "app-1" }]);
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "twenty",
        operation: "ENABLE",
        status: "planning",
        release_version: "2.0.0",
        manifest_digest: "b".repeat(64),
      },
    ]);
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:plan",
      stateMachineArn: "arn:sfn:deployments",
    });
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "twenty",
        operation: "ENABLE",
        status: "planning",
        release_version: "2.0.0",
        manifest_digest: "b".repeat(64),
        plan_execution_arn: "arn:sfn:execution:plan",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "plan_requested" }]);

    await startMod.startManagedApplicationPlan(
      null,
      {
        input: {
          key: "twenty",
          operation: "ENABLE",
          desiredConfig: "{}",
          idempotencyKey: "idem-1",
        },
      },
      {} as any,
      { startExecution: mockStartExecution },
    );

    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          app_key: "twenty",
          release_version: "2.0.0",
          manifest_digest: "b".repeat(64),
          plan_summary: expect.objectContaining({
            releaseVersion: "2.0.0",
            manifestDigest: "b".repeat(64),
            releaseManifestUrl:
              "https://example.com/releases/2.0.0/manifest.json",
          }),
        }),
      ]),
    );
    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          releaseVersion: "2.0.0",
          manifestDigest: "b".repeat(64),
          releaseManifestUrl:
            "https://example.com/releases/2.0.0/manifest.json",
        }),
      }),
    );
  });

  it("hydrates n8n runtime images when an adopted app supplies a release pin without a manifest URL", async () => {
    const manifest = n8nReleaseManifest();
    const manifestDigest = releaseManifestSha256(manifest);
    const manifestUrl =
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.224/thinkwork-release.json";
    const runtimeImage =
      "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.224-n8n-amd64@sha256:" +
      "1".repeat(64);
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => manifest,
    }));

    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN", "arn:sfn:deployments");
    vi.stubEnv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.224");
    vi.stubEnv("THINKWORK_RELEASE_MANIFEST_SHA256", manifestDigest);
    vi.stubEnv("THINKWORK_RELEASE_MANIFEST_URL", manifestUrl);
    selectQueue.push([]); // idempotency lookup
    selectQueue.push([]); // managed application lookup
    returningQueue.push([{ id: "app-1" }]);
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "n8n",
        operation: "ENABLE",
        status: "planning",
        release_version: "v0.1.0-canary.224",
        manifest_digest: manifestDigest,
      },
    ]);
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:plan",
      stateMachineArn: "arn:sfn:deployments",
    });
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "n8n",
        operation: "ENABLE",
        status: "planning",
        release_version: "v0.1.0-canary.224",
        manifest_digest: manifestDigest,
        plan_execution_arn: "arn:sfn:execution:plan",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "plan_requested" }]);

    await startMod.startManagedApplicationPlan(
      null,
      {
        input: {
          key: "n8n",
          operation: "ENABLE",
          releaseVersion: "v0.1.0-canary.224",
          manifestDigest,
          desiredConfig: '{"databaseName":"thinkwork_n8n"}',
          idempotencyKey: "idem-adopted-n8n",
        },
      },
      {} as any,
      { startExecution: mockStartExecution },
    );

    expect(fetch).toHaveBeenCalledWith(manifestUrl);
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          app_key: "n8n",
          release_version: "v0.1.0-canary.224",
          manifest_digest: manifestDigest,
          plan_summary: expect.objectContaining({
            releaseManifestUrl: manifestUrl,
            manifestImages: {
              "n8n-runtime": runtimeImage,
            },
          }),
        }),
      ]),
    );
    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          appKey: "n8n",
          releaseVersion: "v0.1.0-canary.224",
          manifestDigest,
          releaseManifestUrl: manifestUrl,
          manifestImages: {
            "n8n-runtime": runtimeImage,
          },
        }),
      }),
    );
  });

  it("uses resolved deployment controller config when env lacks the state machine", async () => {
    vi.stubEnv("THINKWORK_RELEASE_VERSION", "2.1.0");
    vi.stubEnv("THINKWORK_RELEASE_MANIFEST_SHA256", "e".repeat(64));
    vi.stubEnv(
      "THINKWORK_RELEASE_MANIFEST_URL",
      "https://example.com/releases/2.1.0/manifest.json",
    );
    selectQueue.push([]); // idempotency lookup
    selectQueue.push([]); // managed application lookup
    returningQueue.push([{ id: "app-1" }]);
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "twenty",
        operation: "ENABLE",
        status: "planning",
        release_version: "2.1.0",
        manifest_digest: "e".repeat(64),
      },
    ]);
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:plan",
      stateMachineArn: "arn:sfn:from-profile",
    });
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "twenty",
        operation: "ENABLE",
        status: "planning",
        release_version: "2.1.0",
        manifest_digest: "e".repeat(64),
        state_machine_arn: "arn:sfn:from-profile",
        plan_execution_arn: "arn:sfn:execution:plan",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "plan_execution_started" }]);

    await startMod.startManagedApplicationPlan(
      null,
      {
        input: {
          key: "twenty",
          operation: "ENABLE",
          desiredConfig: "{}",
          idempotencyKey: "idem-profile",
        },
      },
      {} as any,
      {
        startExecution: mockStartExecution,
        resolveDeploymentControllerConfig: async () => ({
          stateMachineArn: "arn:sfn:from-profile",
          evidenceBucket: "profile-evidence",
          customerDomain: "tei.thinkwork.ai",
          customerDomainDelegated: true,
          customerDomainLegacyRetired: false,
          appCertificateArn: "arn:aws:acm:us-east-1:123:certificate/crm",
        }),
      },
    );

    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stateMachineArn: "arn:sfn:from-profile",
        payload: expect.objectContaining({
          evidence: expect.objectContaining({
            bucket: "profile-evidence",
            prefix: "tenant-1/twenty/job-1/plan",
          }),
          desiredConfig: expect.objectContaining({
            domain: "crm.tei.thinkwork.ai",
            publicUrl: "https://crm.tei.thinkwork.ai",
            certificateArn: "arn:aws:acm:us-east-1:123:certificate/crm",
          }),
        }),
      }),
    );
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          desired_config: expect.objectContaining({
            publicUrl: "https://crm.tei.thinkwork.ai",
          }),
        }),
      ]),
    );
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state_machine_arn: "arn:sfn:from-profile",
          evidence_bucket: "profile-evidence",
          evidence_prefix: "tenant-1/twenty/job-1/plan",
          plan_execution_arn: "arn:sfn:execution:plan",
        }),
      ]),
    );
  });

  it("re-drives an existing planning job once controller config is available", async () => {
    const pendingJob = {
      id: "job-pending",
      tenant_id: "tenant-1",
      app_key: "twenty",
      operation: "ENABLE",
      status: "planning",
      release_version: "2.1.0",
      manifest_digest: "e".repeat(64),
      desired_config_version: "v1",
      plan_execution_arn: null,
      evidence_bucket: "profile-evidence",
      plan_summary: {
        releaseManifestUrl: "https://example.com/releases/2.1.0/manifest.json",
        desiredConfig: { region: "us-east-1" },
        manifestImages: {
          twenty: `public.ecr.aws/thinkwork/twenty@sha256:${"2".repeat(64)}`,
        },
      },
    };
    selectQueue.push([pendingJob]); // idempotency lookup
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:plan",
      stateMachineArn: "arn:sfn:from-profile",
    });
    returningQueue.push([
      {
        ...pendingJob,
        state_machine_arn: "arn:sfn:from-profile",
        plan_execution_arn: "arn:sfn:execution:plan",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "plan_execution_started" }]);

    const result = await startMod.startManagedApplicationPlan(
      null,
      {
        input: {
          key: "twenty",
          operation: "ENABLE",
          idempotencyKey: "idem-pending",
        },
      },
      {} as any,
      {
        startExecution: mockStartExecution,
        resolveDeploymentControllerConfig: async () => ({
          stateMachineArn: "arn:sfn:from-profile",
          evidenceBucket: "profile-evidence",
        }),
      },
    );

    expect(result.planExecutionArn).toBe("arn:sfn:execution:plan");
    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stateMachineArn: "arn:sfn:from-profile",
        payload: expect.objectContaining({
          jobId: "job-pending",
          desiredConfig: { region: "us-east-1" },
          manifestImages: {
            twenty: `public.ecr.aws/thinkwork/twenty@sha256:${"2".repeat(64)}`,
          },
        }),
      }),
    );
  });

  it("rejects explicit whitespace-only release versions", async () => {
    selectQueue.push([]); // idempotency lookup

    await expect(
      startMod.startManagedApplicationPlan(
        null,
        {
          input: {
            key: "twenty",
            operation: "ENABLE",
            releaseVersion: "   ",
            manifestDigest: "c".repeat(64),
            idempotencyKey: "idem-1",
          },
        },
        {} as any,
        { startExecution: mockStartExecution },
      ),
    ).rejects.toThrow(/release is unresolved/);

    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects malformed manifest digests", async () => {
    selectQueue.push([]); // idempotency lookup

    await expect(
      startMod.startManagedApplicationPlan(
        null,
        {
          input: {
            key: "twenty",
            operation: "ENABLE",
            releaseVersion: "2.0.0",
            manifestDigest: "not-a-sha",
            idempotencyKey: "idem-1",
          },
        },
        {} as any,
        { startExecution: mockStartExecution },
      ),
    ).rejects.toThrow(/64-character SHA-256 hex digest/);

    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("normalizes explicit release metadata before storage and execution", async () => {
    vi.stubEnv("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN", "arn:sfn:deployments");
    selectQueue.push([]); // idempotency lookup
    selectQueue.push([]); // managed application lookup
    returningQueue.push([{ id: "app-1" }]);
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "twenty",
        operation: "ENABLE",
        status: "planning",
        release_version: "2.0.0",
        manifest_digest: "d".repeat(64),
      },
    ]);
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:plan",
      stateMachineArn: "arn:sfn:deployments",
    });
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        app_key: "twenty",
        operation: "ENABLE",
        status: "planning",
        release_version: "2.0.0",
        manifest_digest: "d".repeat(64),
        plan_execution_arn: "arn:sfn:execution:plan",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "plan_requested" }]);

    await startMod.startManagedApplicationPlan(
      null,
      {
        input: {
          key: "twenty",
          operation: "ENABLE",
          releaseVersion: " 2.0.0 ",
          manifestDigest: ` ${"d".repeat(64)} `,
          manifestUrl: " https://example.com/releases/2.0.0/manifest.json ",
          desiredConfig: "{}",
          idempotencyKey: "idem-1",
        },
      },
      {} as any,
      { startExecution: mockStartExecution },
    );

    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          release_version: "2.0.0",
          manifest_digest: "d".repeat(64),
        }),
      ]),
    );
    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          releaseVersion: "2.0.0",
          manifestDigest: "d".repeat(64),
          releaseManifestUrl:
            "https://example.com/releases/2.0.0/manifest.json",
        }),
      }),
    );
  });

  it("rejects non-admin callers before side effects", async () => {
    mockRequireTenantAdmin.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );

    await expect(
      startMod.startManagedApplicationPlan(
        null,
        {
          input: {
            key: "twenty",
            operation: "DESTROY",
            idempotencyKey: "idem-1",
          },
        },
        {} as any,
        { startExecution: mockStartExecution },
      ),
    ).rejects.toThrow(/tenant admin/i);

    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });
});

function n8nReleaseManifest(): ThinkWorkReleaseManifest {
  return {
    schemaVersion: 1,
    release: {
      version: "0.1.0-canary.224",
      gitSha: "abc123",
      createdAt: "2026-06-20T00:00:00.000Z",
    },
    compatibility: {
      minCliVersion: "0.0.0",
      minRunnerVersion: "0.0.0",
      profileSchemaVersion: 1,
    },
    components: {
      cli: { version: "0.1.0-canary.224" },
      terraform: {
        source: "thinkwork-ai/thinkwork/aws",
        version: "0.1.0-canary.224",
      },
      deploymentRunner: {
        version: "0.1.0-canary.224",
        image: null,
        script: {
          fileName: "thinkwork-runner.py",
          relativePath: "runner/thinkwork-runner.py",
          url: null,
          sha256: "3".repeat(64),
          sizeBytes: 42,
        },
      },
      customerOverlay: { schemaVersion: 1 },
    },
    artifacts: [],
    runtimeImages: [
      {
        name: "n8n-runtime",
        repository:
          "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore",
        tag: "v0.1.0-canary.224-n8n-amd64",
        digest: `sha256:${"1".repeat(64)}`,
        architecture: "amd64",
        uri:
          "487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.224-n8n-amd64@sha256:" +
          "1".repeat(64),
      },
    ],
    managedApps: [
      {
        id: "n8n",
        displayName: "n8n",
        requiredImages: ["n8n-runtime"],
      },
    ],
    signing: {
      acceptedKeyIds: [],
      revokedKeyIds: [],
    },
  };
}
