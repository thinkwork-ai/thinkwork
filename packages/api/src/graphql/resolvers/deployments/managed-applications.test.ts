import { beforeEach, describe, expect, it, vi } from "vitest";

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
      { startExecution: mockStartExecution },
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
