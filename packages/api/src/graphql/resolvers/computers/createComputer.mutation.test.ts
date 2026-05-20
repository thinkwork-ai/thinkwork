import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockCreateComputerCore,
  lastCoreInputRef,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockCreateComputerCore: vi.fn(),
  lastCoreInputRef: { value: null as Record<string, unknown> | null },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
  // Mutation migration: admin-write resolvers now call
  // requireAdminOrServiceCaller; delegate to the same mock so existing
  // role-gate expectations carry over unchanged.
  requireAdminOrServiceCaller: (ctx: any, tenantId: string) =>
    mockRequireTenantAdmin(ctx, tenantId),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("./shared.js", () => ({
  createComputerCore: (input: Record<string, unknown>) => {
    lastCoreInputRef.value = input;
    return mockCreateComputerCore(input);
  },
  toGraphqlComputer: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
  }),
}));

let resolver: typeof import("./createComputer.mutation.js");

beforeEach(async () => {
  vi.resetModules();
  mockRequireTenantAdmin.mockReset();
  mockResolveCallerUserId.mockReset();
  mockCreateComputerCore.mockReset();
  lastCoreInputRef.value = null;

  mockResolveCallerUserId.mockResolvedValue("operator-1");
  mockCreateComputerCore.mockResolvedValue({
    id: "computer-1",
    tenant_id: "tenant-1",
  });

  resolver = await import("./createComputer.mutation.js");
});

describe("createComputer", () => {
  it("requires admin, resolves the caller, and delegates to createComputerCore", async () => {
    const result = await resolver.createComputer(
      null,
      {
        input: {
          tenantId: "tenant-1",
          name: "Sales Computer",
          runtimeConfig: '{"mode":"phase-one"}',
          migratedFromAgentId: "agent-1",
          primaryAgentId: "agent-2",
        },
      },
      {} as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "tenant-1");
    expect(mockResolveCallerUserId).toHaveBeenCalledTimes(1);
    expect(lastCoreInputRef.value).toMatchObject({
      tenantId: "tenant-1",
      ownerUserId: null,
      name: "Sales Computer",
      runtimeConfig: '{"mode":"phase-one"}',
      migratedFromAgentId: "agent-1",
      primaryAgentId: "agent-2",
      createdBy: "operator-1",
    });
    expect(result).toEqual({ id: "computer-1", tenantId: "tenant-1" });
  });

  it("does not call createComputerCore when the admin gate rejects", async () => {
    mockRequireTenantAdmin.mockRejectedValueOnce(new Error("forbidden"));

    await expect(
      resolver.createComputer(
        null,
        {
          input: {
            tenantId: "tenant-1",
            name: "Sales Computer",
          },
        },
        {} as any,
      ),
    ).rejects.toThrow("forbidden");

    expect(mockCreateComputerCore).not.toHaveBeenCalled();
  });

  it("allows shared Computer creation without an owner", async () => {
    await resolver.createComputer(
      null,
      {
        input: {
          tenantId: "tenant-1",
          name: "Sales Computer",
          scope: "SHARED",
        },
      },
      {} as any,
    );

    expect(lastCoreInputRef.value).toMatchObject({
      tenantId: "tenant-1",
      ownerUserId: null,
      name: "Sales Computer",
      scope: "SHARED",
      createdBy: "operator-1",
    });
  });

  it("propagates errors thrown by createComputerCore", async () => {
    mockCreateComputerCore.mockRejectedValueOnce(new Error("conflict"));

    await expect(
      resolver.createComputer(
        null,
        {
          input: {
            tenantId: "tenant-1",
            name: "Sales Computer",
          },
        },
        {} as any,
      ),
    ).rejects.toThrow("conflict");
  });
});
