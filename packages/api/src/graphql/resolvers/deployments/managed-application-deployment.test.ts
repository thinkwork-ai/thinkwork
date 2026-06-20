import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  returningQueue,
  updateCalls,
  insertCalls,
  mockStartExecution,
  mockS3Send,
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
  const mockS3Send = vi.fn();
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
    mockS3Send,
    mockRequireTenantAdmin,
    mockResolveCallerTenantId,
    mockResolveCallerUserId,
    mockDb,
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: vi.fn((input) => ({ input })),
  S3Client: vi.fn(() => ({ send: mockS3Send })),
}));

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
let queryMod: typeof import("./managedApplicationDeployment.query.js");

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
  mockS3Send.mockReset();
  mockRequireTenantAdmin.mockReset().mockResolvedValue("owner");
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
  approveMod =
    await import("./approveManagedApplicationDeployment.mutation.js");
  rejectMod = await import("./rejectManagedApplicationDeployment.mutation.js");
  queryMod = await import("./managedApplicationDeployment.query.js");
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
          customerDomain: "tei.thinkwork.ai",
          customerDomainDelegated: true,
          customerDomainLegacyRetired: false,
          appCertificateArn: "arn:aws:acm:us-east-1:123:certificate/app",
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

  it("uses resolved controller config when an approval-ready job lacks a stored state machine", async () => {
    const jobWithoutController = {
      ...destructiveJob,
      state_machine_arn: null,
      evidence_bucket: null,
    };
    selectQueue.push([jobWithoutController]);
    returningQueue.push([{ ...jobWithoutController, status: "applying" }]);
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:apply",
      stateMachineArn: "arn:sfn:from-profile",
    });
    returningQueue.push([
      {
        ...jobWithoutController,
        status: "applying",
        apply_execution_arn: "arn:sfn:execution:apply",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "deployment_approved" }]);

    await approveMod.approveManagedApplicationDeployment(
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
      {
        startExecution: mockStartExecution,
        resolveDeploymentControllerConfig: async () => ({
          stateMachineArn: "arn:sfn:from-profile",
          evidenceBucket: "profile-evidence",
        }),
      },
    );

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "applying",
          state_machine_arn: "arn:sfn:from-profile",
        }),
      ]),
    );
    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stateMachineArn: "arn:sfn:from-profile",
        payload: expect.objectContaining({
          phase: "apply",
          evidence: expect.objectContaining({
            bucket: "profile-evidence",
            prefix: "tenant-1/twenty/job-1/apply",
          }),
        }),
      }),
    );
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

describe("managed application deployment evidence reconciliation", () => {
  it("turns successful plan evidence into an approval-ready job", async () => {
    const planDigest = "c".repeat(64);
    const planningJob = {
      ...destructiveJob,
      id: "job-plan",
      app_key: "plane",
      operation: "ENABLE",
      status: "planning",
      application_id: "app-1",
      plan_digest: null,
      evidence_bucket: "evidence-bucket",
      evidence_prefix: "tenant-1/plane/job-plan/plan",
      plan_summary: {
        desiredConfig: { publicUrl: "https://plane.example.test" },
      },
    };
    mockS3Send.mockResolvedValue({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            status: "succeeded",
            terraformExitCode: 0,
            codebuildBuildId: "build-1",
            terraform: {
              plan: {
                artifact: { sha256: planDigest },
                summary: { resourceChangeCount: 12 },
              },
            },
          }),
      },
    });
    returningQueue.push([
      {
        ...planningJob,
        status: "awaiting_approval",
        plan_digest: planDigest,
        codebuild_build_arn: "build-1",
      },
    ]);
    selectQueue.push([planningJob]);
    selectQueue.push([{ id: "event-1", event_type: "plan_evidence_reconciled" }]);

    const result = await queryMod.managedApplicationDeployment(
      null,
      { jobId: "job-plan" },
      {} as any,
    );

    expect(mockS3Send.mock.calls[0][0].input).toEqual({
      Bucket: "evidence-bucket",
      Key: "tenant-1/plane/job-plan/plan/deployment-evidence.json",
    });
    expect(result.status).toBe("awaiting_approval");
    expect(result.planDigest).toBe(planDigest);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "awaiting_approval",
          plan_digest: planDigest,
          plan_summary: expect.objectContaining({
            desiredConfig: { publicUrl: "https://plane.example.test" },
            terraform: { plan: { resourceChangeCount: 12 } },
          }),
        }),
      ]),
    );
  });

  it("turns successful apply evidence into a succeeded enabled app", async () => {
    const applyingJob = {
      ...destructiveJob,
      id: "job-apply",
      app_key: "plane",
      operation: "ENABLE",
      status: "applying",
      application_id: "app-1",
      evidence_bucket: "evidence-bucket",
      evidence_prefix: "tenant-1/plane/job-apply/plan",
    };
    mockS3Send.mockResolvedValue({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            status: "succeeded",
            terraformExitCode: 0,
            codebuildBuildId: "build-2",
            terraform: {
              outputs: {
                plane_url: { value: "https://plane.example.test" },
              },
            },
          }),
      },
    });
    returningQueue.push([
      {
        ...applyingJob,
        status: "succeeded",
        codebuild_build_arn: "build-2",
      },
    ]);
    returningQueue.push([{ id: "app-1", current_status: "enabled" }]);
    selectQueue.push([applyingJob]);
    selectQueue.push([{ id: "event-1", event_type: "apply_evidence_reconciled" }]);

    const result = await queryMod.managedApplicationDeployment(
      null,
      { jobId: "job-apply" },
      {} as any,
    );

    expect(mockS3Send.mock.calls[0][0].input).toEqual({
      Bucket: "evidence-bucket",
      Key: "tenant-1/plane/job-apply/apply/deployment-evidence.json",
    });
    expect(result.status).toBe("succeeded");
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "succeeded" }),
        expect.objectContaining({ current_status: "enabled" }),
      ]),
    );
  });
});
