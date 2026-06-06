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
  snakeToCamel: (row: Record<string, unknown>) => row,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

let evidenceMod: typeof import("./deploymentEvidence.query.js");

beforeEach(async () => {
  vi.resetModules();
  selectQueue.length = 0;
  mockRequireTenantAdmin.mockReset().mockResolvedValue("admin");
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
  evidenceMod = await import("./deploymentEvidence.query.js");
});

describe("deployment evidence", () => {
  it("returns only the tenant-scoped evidence pointer for a job", async () => {
    selectQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        evidence_bucket: "evidence-bucket",
        evidence_prefix: "tenant-1/twenty/job-1/plan",
      },
    ]);

    const result = await evidenceMod.deploymentEvidence(
      null,
      { jobId: "job-1" },
      {} as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "tenant-1");
    expect(result).toEqual({
      jobId: "job-1",
      bucket: "evidence-bucket",
      prefix: "tenant-1/twenty/job-1/plan",
      urls: ["s3://evidence-bucket/tenant-1/twenty/job-1/plan"],
    });
  });

  it("rejects a member caller before reading evidence", async () => {
    mockRequireTenantAdmin.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );

    await expect(
      evidenceMod.deploymentEvidence(null, { jobId: "job-1" }, {} as any),
    ).rejects.toThrow(/tenant admin/i);

    expect(selectQueue).toHaveLength(0);
  });
});
