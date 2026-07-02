import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireTenantAdmin = vi.fn();

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../../utils.js", () => ({
  db: {},
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  workflows: {
    id: "workflows.id",
    tenant_id: "workflows.tenant_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

let resolver: typeof import("./deleteWorkflow.mutation.js");

beforeEach(async () => {
  mockRequireTenantAdmin.mockReset().mockResolvedValue("admin");
  vi.resetModules();
  resolver = await import("./deleteWorkflow.mutation.js");
});

describe("deleteWorkflow", () => {
  it("authorizes the workflow tenant before deleting the record", async () => {
    const selectLimit = vi.fn().mockResolvedValue([
      {
        id: "workflow-1",
        tenant_id: "tenant-1",
      },
    ]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    const select = vi.fn().mockReturnValue({ from: selectFrom });
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFrom = vi.fn().mockReturnValue({ where: deleteWhere });
    const db = {
      select,
      delete: deleteFrom,
    };

    const result = await resolver.deleteWorkflow(
      null,
      { id: "workflow-1" },
      { auth: { tenantId: "tenant-1" } } as any,
      { db: db as any },
    );

    expect(result).toBe("workflow-1");
    expect(select).toHaveBeenCalledWith({
      id: "workflows.id",
      tenant_id: "workflows.tenant_id",
    });
    expect(selectWhere).toHaveBeenCalledWith({
      eq: ["workflows.id", "workflow-1"],
    });
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      { auth: { tenantId: "tenant-1" } },
      "tenant-1",
      db,
    );
    expect(deleteFrom).toHaveBeenCalledWith({
      id: "workflows.id",
      tenant_id: "workflows.tenant_id",
    });
    expect(deleteWhere).toHaveBeenCalledWith({
      eq: ["workflows.id", "workflow-1"],
    });
  });

  it("does not delete when the workflow is missing", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      delete: vi.fn(),
    };

    await expect(
      resolver.deleteWorkflow(null, { id: "missing-workflow" }, {} as any, {
        db: db as any,
      }),
    ).rejects.toThrow("Workflow not found");

    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
});
