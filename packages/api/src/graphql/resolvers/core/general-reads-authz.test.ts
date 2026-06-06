import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAdminOrServiceCaller,
  mockRequireTenantMember,
  mockResolveCallerTenantId,
  mockSelect,
} = vi.hoisted(() => ({
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockSelect: vi.fn(),
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

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(rows),
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
    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );
    expect(result).toMatchObject({ source: "AWS" });
    expect(result).toHaveProperty("accountId");
    expect(result.managedApplications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "cognee", enabled: false }),
        expect.objectContaining({
          key: "twenty",
          status: "disabled",
          enabled: false,
        }),
      ]),
    );
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
        "arn:aws:ecs:us-east-1:123456789012:cluster/thinkwork-dev-cognee-cluster",
      cogneeServiceName: "thinkwork-dev-cognee",
    });
  });

  it("expands Twenty compact deployment status into managed app fields", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
    vi.stubEnv(
      "TWENTY",
      [
        "1",
        "1",
        "https://crm.example.com",
        "cluster-arn",
        "server-service",
        "worker-service",
        "/thinkwork/dev/twenty/server",
        "/thinkwork/dev/twenty/worker",
        "alb-arn",
        "target-group-arn",
      ].join("|"),
    );

    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );

    expect(result).toMatchObject({
      twentyProvisioned: true,
      twentyRuntimeEnabled: true,
      twentyUrl: "https://crm.example.com",
      twentyClusterArn: "cluster-arn",
      twentyServerServiceName: "server-service",
      twentyWorkerServiceName: "worker-service",
      twentyServerLogGroupName: "/thinkwork/dev/twenty/server",
      twentyWorkerLogGroupName: "/thinkwork/dev/twenty/worker",
      twentyAlbArn: "alb-arn",
      twentyTargetGroupArn: "target-group-arn",
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
          serviceNames: ["server-service", "worker-service"],
        }),
      ]),
    );
  });

  it("reports malformed Twenty compact status as unknown without throwing", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
    vi.stubEnv("TWENTY", "not-a-compact-status");

    const result = await deploymentStatusMod.deploymentStatus(
      null,
      {},
      service,
    );

    expect(result.twentyProvisioned).toBe(false);
    expect(result.twentyRuntimeEnabled).toBe(false);
    expect(result.managedApplications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "twenty",
          status: "unknown",
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
