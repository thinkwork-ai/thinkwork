import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockInsert,
  mockRequireTenantAdmin,
  mockRequireTenantUser,
  mockRequireTenantAgent,
  mockRequireComputerTemplate,
  mockAssertNoActiveComputer,
  mockResolveCallerUserId,
  lastInsertValuesRef,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockRequireTenantUser: vi.fn(),
  mockRequireTenantAgent: vi.fn(),
  mockRequireComputerTemplate: vi.fn(),
  mockAssertNoActiveComputer: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  lastInsertValuesRef: { value: null as Record<string, unknown> | null },
}));

vi.mock("../../utils.js", () => ({
  db: {
    insert: mockInsert,
  },
  computers: {},
  generateSlug: () => "generated-slug",
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("./shared.js", () => ({
  assertNoActiveComputer: mockAssertNoActiveComputer,
  parseJsonInput: (value: unknown) =>
    typeof value === "string" ? JSON.parse(value) : value,
  requireComputerTemplate: mockRequireComputerTemplate,
  requireTenantAgent: mockRequireTenantAgent,
  requireTenantUser: mockRequireTenantUser,
  toGraphqlComputer: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
  }),
}));

let resolver: typeof import("./createComputer.mutation.js");

beforeEach(async () => {
  vi.resetModules();
  mockInsert.mockReset();
  mockRequireTenantAdmin.mockReset();
  mockRequireTenantUser.mockReset();
  mockRequireTenantAgent.mockReset();
  mockRequireComputerTemplate.mockReset();
  mockAssertNoActiveComputer.mockReset();
  mockResolveCallerUserId.mockReset();
  lastInsertValuesRef.value = null;

  mockResolveCallerUserId.mockResolvedValue("operator-1");
  mockInsert.mockReturnValue({
    values: (values: Record<string, unknown>) => {
      lastInsertValuesRef.value = values;
      return {
        returning: () =>
          Promise.resolve([{ id: "computer-1", tenant_id: "tenant-1" }]),
      };
    },
  });

  resolver = await import("./createComputer.mutation.js");
});

describe("createComputer", () => {
  it("requires admin, owner, template, and one-Computer invariants before insert", async () => {
    const result = await resolver.createComputer(
      null,
      {
        input: {
          tenantId: "tenant-1",
          ownerUserId: "user-1",
          templateId: "template-1",
          name: "Eric's Computer",
          runtimeConfig: '{"mode":"phase-one"}',
          migratedFromAgentId: "agent-1",
        },
      },
      {} as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "tenant-1");
    expect(mockRequireTenantUser).toHaveBeenCalledWith("tenant-1", "user-1");
    expect(mockRequireComputerTemplate).toHaveBeenCalledWith(
      "tenant-1",
      "template-1",
    );
    expect(mockRequireTenantAgent).toHaveBeenCalledWith("tenant-1", "agent-1");
    expect(mockAssertNoActiveComputer).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
    );
    expect(lastInsertValuesRef.value).toMatchObject({
      tenant_id: "tenant-1",
      owner_user_id: "user-1",
      template_id: "template-1",
      slug: "generated-slug",
      runtime_config: { mode: "phase-one" },
      created_by: "operator-1",
    });
    expect(result).toEqual({ id: "computer-1", tenantId: "tenant-1" });
  });

  it("does not insert when the user already has an active Computer", async () => {
    mockAssertNoActiveComputer.mockRejectedValue(new Error("conflict"));

    await expect(
      resolver.createComputer(
        null,
        {
          input: {
            tenantId: "tenant-1",
            ownerUserId: "user-1",
            templateId: "template-1",
            name: "Eric's Computer",
          },
        },
        {} as any,
      ),
    ).rejects.toThrow("conflict");

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
