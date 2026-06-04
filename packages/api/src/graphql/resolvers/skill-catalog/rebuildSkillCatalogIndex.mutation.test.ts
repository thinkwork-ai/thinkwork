import { beforeEach, describe, expect, it, vi } from "vitest";

// The rescan logic is unit-tested in catalog-index.test.ts; here we test the
// resolver's authorization gating and result mapping (U6 / security review P1).

const {
  rebuildMock,
  requireTenantAdminMock,
  resolveCallerTenantIdMock,
  tenantRowsRef,
} = vi.hoisted(() => ({
  rebuildMock: vi.fn(),
  requireTenantAdminMock: vi.fn(),
  resolveCallerTenantIdMock: vi.fn(),
  tenantRowsRef: { rows: [] as Array<{ id: string; slug: string }> },
}));

vi.mock("../../utils.js", () => {
  const thenable = () => {
    const p = Promise.resolve(tenantRowsRef.rows);
    return Object.assign(p, {
      where: () => Promise.resolve(tenantRowsRef.rows),
    });
  };
  return {
    db: { select: () => ({ from: () => thenable() }) },
    eq: () => ({}),
    tenants: { id: "id", slug: "slug" },
  };
});
vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: requireTenantAdminMock,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
}));
vi.mock("../../../lib/catalog-index.js", () => ({
  rebuildTenantCatalogIndex: rebuildMock,
}));

let mod: typeof import("./rebuildSkillCatalogIndex.mutation.js");

const ctx = (email: string) =>
  ({ auth: { authType: "cognito", email } }) as never;

beforeEach(async () => {
  vi.resetModules();
  rebuildMock.mockReset().mockResolvedValue({
    skillsInS3: 2,
    rowsUpserted: 2,
    rowsSkipped: 0,
    rowsDeleted: 0,
  });
  requireTenantAdminMock.mockReset().mockResolvedValue("admin");
  resolveCallerTenantIdMock.mockReset().mockResolvedValue("caller-tenant");
  tenantRowsRef.rows = [];
  vi.stubEnv("WORKSPACE_BUCKET", "test-bucket");
  vi.stubEnv("THINKWORK_PLATFORM_OPERATOR_EMAILS", "ops@example.com");
  mod = await import("./rebuildSkillCatalogIndex.mutation.js");
});

describe("rebuildSkillCatalogIndex", () => {
  it("rejects all=true for a non-operator and does not rebuild", async () => {
    tenantRowsRef.rows = [
      { id: "t1", slug: "a" },
      { id: "t2", slug: "b" },
    ];
    await expect(
      mod.rebuildSkillCatalogIndex(
        null,
        { all: true },
        ctx("user@example.com"),
      ),
    ).rejects.toThrow(/operator/i);
    expect(rebuildMock).not.toHaveBeenCalled();
  });

  it("rebuilds every tenant for a platform operator", async () => {
    tenantRowsRef.rows = [
      { id: "t1", slug: "a" },
      { id: "t2", slug: "b" },
    ];
    const res = await mod.rebuildSkillCatalogIndex(
      null,
      { all: true },
      ctx("ops@example.com"),
    );
    expect(res).toHaveLength(2);
    expect(rebuildMock).toHaveBeenCalledTimes(2);
    expect(res[0]).toMatchObject({ tenantSlug: "a", rowsUpserted: 2 });
  });

  it("requires tenant admin for a single-tenant rebuild", async () => {
    tenantRowsRef.rows = [{ id: "t1", slug: "a" }];
    requireTenantAdminMock.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );
    await expect(
      mod.rebuildSkillCatalogIndex(
        null,
        { tenantId: "t1" },
        ctx("user@example.com"),
      ),
    ).rejects.toThrow(/admin/i);
    expect(rebuildMock).not.toHaveBeenCalled();
  });

  it("rebuilds a single tenant for an admin, defaulting to the caller's tenant", async () => {
    tenantRowsRef.rows = [{ id: "caller-tenant", slug: "home" }];
    const res = await mod.rebuildSkillCatalogIndex(
      null,
      {},
      ctx("user@example.com"),
    );
    expect(requireTenantAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      "caller-tenant",
    );
    expect(res).toHaveLength(1);
    expect(res[0].tenantSlug).toBe("home");
  });

  it("passes dryRun through and flags it on the results", async () => {
    tenantRowsRef.rows = [{ id: "t1", slug: "a" }];
    const res = await mod.rebuildSkillCatalogIndex(
      null,
      { tenantId: "t1", dryRun: true },
      ctx("user@example.com"),
    );
    expect(rebuildMock).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
    expect(res[0].dryRun).toBe(true);
  });
});
