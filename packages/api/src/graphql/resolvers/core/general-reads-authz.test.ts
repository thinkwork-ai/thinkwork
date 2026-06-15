import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAdminOrServiceCaller,
  mockRequireTenantMember,
  mockResolveCallerTenantId,
  mockS3Send,
  mockSelect,
  mockSsmSend,
} = vi.hoisted(() => ({
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockS3Send: vi.fn(),
  mockSelect: vi.fn(),
  mockSsmSend: vi.fn(),
}));

vi.mock("./authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("./resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

vi.mock("../../utils.js", () => ({
  db: { select: mockSelect },
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  tenants: { id: "tenants.id" },
  tenantMembers: { tenant_id: "tenant_members.tenant_id" },
  snakeToCamel: (row: Record<string, unknown>) => row,
}));

vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: vi.fn(() => ({ send: mockSsmSend })),
  GetParameterCommand: vi.fn((input) => ({ input })),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: vi.fn((input) => ({ input })),
}));

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

let deploymentStatusMod: typeof import("./deploymentStatus.query.js");
let tenantMod: typeof import("./tenant.query.js");
let tenantMembersMod: typeof import("./tenantMembers.query.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  mockRequireAdminOrServiceCaller.mockReset();
  mockRequireTenantMember.mockReset();
  mockResolveCallerTenantId.mockReset();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockSelect.mockReset();
  mockSelect.mockReturnValue(queryRows([]));
  mockSsmSend.mockReset().mockResolvedValue({ Parameter: { Value: "{}" } });
  mockS3Send
    .mockReset()
    .mockRejectedValue(
      Object.assign(new Error("missing"), { name: "NoSuchKey" }),
    );
  deploymentStatusMod = await import("./deploymentStatus.query.js");
  tenantMod = await import("./tenant.query.js");
  tenantMembersMod = await import("./tenantMembers.query.js");
});

const cognito = { auth: { authType: "cognito" } } as any;
const service = { auth: { authType: "service" } } as any;

describe("deploymentStatus authz", () => {
  it("refuses a member (non-operator) before returning infra fields", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );
    await expect(
      deploymentStatusMod.deploymentStatus(null, {}, cognito),
    ).rejects.toThrow(/admin/i);
    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      cognito,
      "tenant-1",
      "deployment_status:read",
    );
  });

  it("returns the payload for an operator/service caller", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValueOnce(undefined);
    vi.stubEnv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.152");
    vi.stubEnv("THINKWORK_RELEASE_MANIFEST_SHA256", "a".repeat(64));
    vi.stubEnv(
      "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
    );
    vi.stubEnv(
      "THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME",
      "thinkwork-dev-deployment-runner",
    );
    vi.stubEnv("THINKWORK_EVIDENCE_BUCKET", "thinkwork-dev-evidence");
    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );
    expect(result).toMatchObject({
      source: "AWS",
      releaseVersion: "v0.1.0-canary.152",
      releaseManifestSha256: "a".repeat(64),
      deploymentControllerArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
      deploymentRunnerProjectName: "thinkwork-dev-deployment-runner",
      deploymentEvidenceBucket: "thinkwork-dev-evidence",
    });
    expect(result).toHaveProperty("accountId");
    expect(result.managedApplications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "cognee", enabled: false }),
        expect.objectContaining({
          key: "twenty",
          status: "disabled",
          enabled: false,
          managedMcpStatus: "not_ready",
        }),
      ]),
    );
  });

  it("reports compact deployment controller env used by graphql-http release updates", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValueOnce(undefined);
    vi.stubEnv(
      "DEPLOYMENT_STATE_MACHINE_ARN",
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
    );
    vi.stubEnv("DEPLOYMENT_EVIDENCE_BUCKET", "thinkwork-dev-evidence");

    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );

    expect(result).toMatchObject({
      deploymentControllerArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
      deploymentEvidenceBucket: "thinkwork-dev-evidence",
    });
  });

  it("falls back to the SSM deployment profile for deployed release metadata", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValueOnce(undefined);
    vi.stubEnv("STAGE", "tei-e2e");
    mockSsmSend.mockResolvedValueOnce({
      Parameter: {
        Value: JSON.stringify({
          releaseVersion: "v0.1.0-canary.160",
          releaseManifestUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.160/thinkwork-release.json",
          releaseManifestSha256: "f".repeat(64),
          controller: {
            stateMachineArn:
              "arn:aws:states:us-east-1:637423202447:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
            codebuildProjectName: "thinkwork-tei-e2e-deployment-runner",
            evidenceBucketName:
              "thinkwork-tei-e2e-637423202447-deploy-evidence",
          },
        }),
      },
    });

    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );

    expect(result).toMatchObject({
      releaseVersion: "v0.1.0-canary.160",
      releaseManifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.160/thinkwork-release.json",
      releaseManifestSha256: "f".repeat(64),
      deploymentControllerArn:
        "arn:aws:states:us-east-1:637423202447:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
      deploymentRunnerProjectName: "thinkwork-tei-e2e-deployment-runner",
      deploymentEvidenceBucket:
        "thinkwork-tei-e2e-637423202447-deploy-evidence",
    });
  });

  it("prefers the S3 deployment status pointer for the current deployed release", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValueOnce(undefined);
    vi.stubEnv("STAGE", "tei-e2e");
    mockSsmSend.mockResolvedValueOnce({
      Parameter: {
        Value: JSON.stringify({
          releaseVersion: "v0.1.0-canary.159",
          releaseManifestUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.159/thinkwork-release.json",
          releaseManifestSha256: "e".repeat(64),
          controller: {
            stateMachineArn:
              "arn:aws:states:us-east-1:637423202447:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
            codebuildProjectName: "thinkwork-tei-e2e-deployment-runner",
            evidenceBucketName:
              "thinkwork-tei-e2e-637423202447-deploy-evidence",
          },
        }),
      },
    });
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            activeRelease: {
              version: "v0.1.0-canary.160",
              manifestUrl:
                "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.160/thinkwork-release.json",
              manifestSha256: "f".repeat(64),
            },
            controller: {
              stateMachineArn:
                "arn:aws:states:us-east-1:637423202447:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
              codebuildProjectName: "thinkwork-tei-e2e-deployment-runner",
            },
          }),
      },
    });

    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );

    expect(result).toMatchObject({
      releaseVersion: "v0.1.0-canary.160",
      releaseManifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.160/thinkwork-release.json",
      releaseManifestSha256: "f".repeat(64),
      deploymentControllerArn:
        "arn:aws:states:us-east-1:637423202447:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
      deploymentRunnerProjectName: "thinkwork-tei-e2e-deployment-runner",
      deploymentEvidenceBucket:
        "thinkwork-tei-e2e-637423202447-deploy-evidence",
    });
  });

  it("derives Cognee enabled state from deployed Cognee details", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);

    let result = await deploymentStatusMod.deploymentStatus(null, {}, service);
    expect(result.cogneeEnabled).toBe(false);

    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");
    result = await deploymentStatusMod.deploymentStatus(null, {}, service);
    expect(result.cogneeEnabled).toBe(true);
    expect(result).toMatchObject({
      cogneeEndpoint: "http://cognee.internal",
      cogneeBackendMode: "dogfood",
      cogneeLogGroupName: "/thinkwork/dev/cognee",
      cogneeClusterArn:
        "arn:aws:ecs:us-east-1:123456789012:cluster/thinkwork-dev-brain-cluster",
      cogneeServiceName: "thinkwork-dev-cognee",
    });
  });

  it("keeps COGNEE_CLUSTER_ARN as an optional compatibility override", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");
    vi.stubEnv(
      "COGNEE_CLUSTER_ARN",
      "arn:aws:ecs:us-west-2:210987654321:cluster/custom-cognee-cluster",
    );

    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );

    expect(result.cogneeClusterArn).toBe(
      "arn:aws:ecs:us-west-2:210987654321:cluster/custom-cognee-cluster",
    );
  });

  it("serves Twenty managed app fields from DB state (plan 2026-06-12-001 U10)", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");

    const appRow = [
      { desired_config: { publicUrl: "https://crm.example.com" } },
    ];
    const succeededJob = [{ operation: "ENABLE" }];
    // readTwentyStatus (top-level twenty* fields) reads the row + latest
    // succeeded job; twentyManagedApplication reads them again; the managed
    // MCP enrichment select falls through to the default [] mock.
    mockSelect
      .mockReturnValueOnce(queryRows(appRow))
      .mockReturnValueOnce(queryRows(succeededJob))
      .mockReturnValueOnce(queryRows(appRow))
      .mockReturnValueOnce(queryRows(succeededJob));

    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );

    expect(result).toMatchObject({
      twentyProvisioned: true,
      twentyRuntimeEnabled: true,
      twentyUrl: "https://crm.example.com",
      // ECS identifiers are stage-derived stable names; ALB/target-group
      // ARNs are not DB-projected (null).
      twentyClusterArn:
        "arn:aws:ecs:us-east-1:123456789012:cluster/thinkwork-dev-twenty-cluster",
      twentyServerServiceName: "thinkwork-dev-twenty-server",
      twentyWorkerServiceName: "thinkwork-dev-twenty-worker",
      twentyServerLogGroupName: "/thinkwork/dev/twenty/server",
      twentyWorkerLogGroupName: "/thinkwork/dev/twenty/worker",
      twentyAlbArn: null,
      twentyTargetGroupArn: null,
    });
    expect(result.managedApplications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "twenty",
          displayName: "Twenty CRM",
          status: "running",
          enabled: true,
          provisioned: true,
          runtimeEnabled: true,
          url: "https://crm.example.com",
          logGroupNames: [
            "/thinkwork/dev/twenty/server",
            "/thinkwork/dev/twenty/worker",
          ],
          serviceNames: [
            "thinkwork-dev-twenty-server",
            "thinkwork-dev-twenty-worker",
          ],
          managedMcpStatus: "missing",
          managedMcpInstallAvailable: true,
        }),
      ]),
    );
  });

  it("ignores the retired TWENTY env projection: no DB state means disabled", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
    // The legacy compact env value must have NO effect — U10 removed the
    // env-var status path for Twenty (Cognee's stays).
    vi.stubEnv("TWENTY", "1|1|https://crm.example.com");

    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );

    expect(result.twentyProvisioned).toBe(false);
    expect(result.twentyRuntimeEnabled).toBe(false);
    expect(result.twentyUrl).toBeNull();
    expect(result.managedApplications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "twenty",
          status: "disabled",
          enabled: false,
          provisioned: false,
          runtimeEnabled: false,
        }),
      ]),
    );
  });
});

describe("tenant query authz", () => {
  it("refuses a cognito non-member before reading the row", async () => {
    mockRequireTenantMember.mockRejectedValueOnce(
      new Error("Tenant membership required"),
    );
    await expect(
      tenantMod.tenant(null, { id: "tenant-2" }, cognito),
    ).rejects.toThrow(/membership/i);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns the tenant for a cognito member", async () => {
    mockRequireTenantMember.mockResolvedValueOnce("owner");
    mockSelect.mockReturnValueOnce(
      queryRows([{ id: "tenant-1", name: "Tenant One" }]),
    );
    const result = await tenantMod.tenant(null, { id: "tenant-1" }, cognito);
    expect(result).toMatchObject({ id: "tenant-1", name: "Tenant One" });
    expect(mockRequireTenantMember).toHaveBeenCalledWith(cognito, "tenant-1");
  });

  it("does not gate service callers", async () => {
    mockSelect.mockReturnValueOnce(queryRows([{ id: "tenant-1" }]));
    await tenantMod.tenant(null, { id: "tenant-1" }, service);
    expect(mockRequireTenantMember).not.toHaveBeenCalled();
  });
});

describe("tenantMembers query authz", () => {
  it("refuses a cognito non-member before enumerating members", async () => {
    mockRequireTenantMember.mockRejectedValueOnce(
      new Error("Tenant membership required"),
    );
    await expect(
      tenantMembersMod.tenantMembers_(null, { tenantId: "tenant-2" }, cognito),
    ).rejects.toThrow(/membership/i);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("enumerates members for a cognito member", async () => {
    mockRequireTenantMember.mockResolvedValueOnce("member");
    mockSelect.mockReturnValueOnce(queryRows([]));
    const result = await tenantMembersMod.tenantMembers_(
      null,
      { tenantId: "tenant-1" },
      cognito,
    );
    expect(result).toEqual([]);
    expect(mockRequireTenantMember).toHaveBeenCalledWith(cognito, "tenant-1");
  });
});
