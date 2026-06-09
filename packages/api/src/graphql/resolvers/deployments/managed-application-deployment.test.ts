import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  returningQueue,
  updateCalls,
  insertCalls,
  mockStartExecution,
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockDb,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const returningQueue: unknown[][] = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const mockStartExecution = vi.fn();
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
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push(values);
        return {
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
          }),
        };
      },
    })),
  };
  return {
    selectQueue,
    returningQueue,
    updateCalls,
    insertCalls,
    mockStartExecution,
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

let approveMod: typeof import("./approveManagedApplicationDeployment.mutation.js");
let rejectMod: typeof import("./rejectManagedApplicationDeployment.mutation.js");

const destructiveJob = {
  id: "job-1",
  tenant_id: "tenant-1",
  app_key: "twenty",
  operation: "DESTROY",
  status: "awaiting_approval",
  release_version: "1.2.3",
  manifest_digest: "a".repeat(64),
  desired_config_version: "v1",
  plan_digest: "b".repeat(64),
  state_machine_arn: "arn:sfn:deployments",
  evidence_bucket: "evidence-bucket",
  data_impact: { destructive: true },
  plan_summary: {
    releaseManifestUrl:
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/thinkwork-release.json",
    desiredConfig: { retainedDataSnapshot: "snap-1" },
    manifestImages: {
      twenty: `public.ecr.aws/thinkwork/twenty@sha256:${"1".repeat(64)}`,
    },
  },
};

beforeEach(async () => {
  vi.resetModules();
  selectQueue.length = 0;
  returningQueue.length = 0;
  updateCalls.length = 0;
  insertCalls.length = 0;
  mockStartExecution.mockReset();
  mockRequireTenantAdmin.mockReset().mockResolvedValue("owner");
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
  approveMod =
    await import("./approveManagedApplicationDeployment.mutation.js");
  rejectMod = await import("./rejectManagedApplicationDeployment.mutation.js");
});

describe("managed application deployment approval", () => {
  it("requires explicit confirmation before destructive apply", async () => {
    selectQueue.push([destructiveJob]);

    await expect(
      approveMod.approveManagedApplicationDeployment(
        null,
        {
          input: {
            jobId: "job-1",
            planDigest: "b".repeat(64),
            manifestDigest: "a".repeat(64),
          },
        },
        {} as any,
        { startExecution: mockStartExecution },
      ),
    ).rejects.toThrow(/DESTROY confirmation/);

    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("starts a separate apply execution after approval", async () => {
    selectQueue.push([destructiveJob]);
    returningQueue.push([{ ...destructiveJob, status: "applying" }]);
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:apply",
      stateMachineArn: "arn:sfn:deployments",
    });
    returningQueue.push([
      {
        ...destructiveJob,
        status: "applying",
        apply_execution_arn: "arn:sfn:execution:apply",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "deployment_approved" }]);

    const result = await approveMod.approveManagedApplicationDeployment(
      null,
      {
        input: {
          jobId: "job-1",
          planDigest: "b".repeat(64),
          manifestDigest: "a".repeat(64),
          destructiveConfirmation: "DESTROY",
        },
      },
      {} as any,
      { startExecution: mockStartExecution },
    );

    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          schemaVersion: 1,
          contract: "thinkwork.deployment.controller.v1",
          phase: "apply",
          jobId: "job-1",
          operation: "DESTROY",
          planDigest: "b".repeat(64),
          release: expect.objectContaining({
            version: "1.2.3",
            manifestSha256: "a".repeat(64),
          }),
          releaseManifestUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/thinkwork-release.json",
          desiredConfig: { retainedDataSnapshot: "snap-1" },
          manifestImages: {
            twenty: `public.ecr.aws/thinkwork/twenty@sha256:${"1".repeat(64)}`,
          },
          evidence: expect.objectContaining({
            bucket: "evidence-bucket",
            prefix: "tenant-1/twenty/job-1/apply",
          }),
        }),
      }),
    );
    expect(result.applyExecutionArn).toBe("arn:sfn:execution:apply");
  });

  it("rejects an approval-ready job without starting apply", async () => {
    selectQueue.push([destructiveJob]);
    returningQueue.push([
      {
        ...destructiveJob,
        status: "rejected",
        rejected_by_user_id: "user-1",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "deployment_rejected" }]);

    const result = await rejectMod.rejectManagedApplicationDeployment(
      null,
      { input: { jobId: "job-1", reason: "Need a smaller plan." } },
      {} as any,
    );

    expect(result.status).toBe("rejected");
    expect(mockStartExecution).not.toHaveBeenCalled();
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "rejected",
          rejected_by_user_id: "user-1",
        }),
      ]),
    );
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "deployment_rejected" }),
      ]),
    );
  });
});
