import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelectRows,
  mockUpdateRows,
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockRecordActivity,
  updateCallRef,
  lastUpdateSetRef,
} = vi.hoisted(() => ({
  mockSelectRows: vi.fn(),
  mockUpdateRows: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockRecordActivity: vi.fn(),
  updateCallRef: { value: 0 },
  lastUpdateSetRef: { value: null as Record<string, unknown> | null },
}));

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows() as unknown[]),
      }),
    })),
    update: vi.fn(() => {
      updateCallRef.value++;
      return {
        set: (value: Record<string, unknown>) => {
          lastUpdateSetRef.value = value;
          return {
            where: () => ({
              returning: () => Promise.resolve(mockUpdateRows() as unknown[]),
            }),
          };
        },
      };
    }),
  },
  eq: (..._args: any[]) => ({ _eq: _args }),
  and: (..._args: any[]) => ({ _and: _args }),
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    runtime: "agents.runtime",
  },
  agentToCamel: (obj: Record<string, unknown>) => ({
    ...obj,
    runtime:
      typeof obj.runtime === "string" ? obj.runtime.toUpperCase() : obj.runtime,
  }),
  recordActivity: mockRecordActivity,
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

import { updateAgentRuntime } from "../graphql/resolvers/agents/updateAgentRuntime.mutation.js";

const CTX = {
  auth: {
    authType: "cognito",
    principalId: "sub-1",
    tenantId: null,
    email: "operator@example.com",
  },
} as any;

describe("updateAgentRuntime", () => {
  beforeEach(() => {
    mockSelectRows.mockReset();
    mockUpdateRows.mockReset();
    mockRequireTenantAdmin.mockReset();
    mockResolveCallerUserId.mockReset();
    mockRecordActivity.mockReset();
    updateCallRef.value = 0;
    lastUpdateSetRef.value = null;
  });

  it("requires tenant admin on the agent's row-derived tenant", async () => {
    mockSelectRows.mockReturnValue([
      { tenant_id: "tenant-A", runtime: "strands" },
    ]);
    mockUpdateRows.mockReturnValue([
      { id: "agent-1", tenant_id: "tenant-A", runtime: "flue" },
    ]);
    mockRequireTenantAdmin.mockResolvedValue("admin");
    mockResolveCallerUserId.mockResolvedValue("user-1");

    const result = await updateAgentRuntime(
      null,
      { id: "agent-1", runtime: "FLUE" },
      CTX,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(CTX, "tenant-A");
    expect(lastUpdateSetRef.value).toMatchObject({ runtime: "flue" });
    expect(result.runtime).toBe("FLUE");
    expect(mockRecordActivity).toHaveBeenCalledWith(
      "tenant-A",
      "user",
      "user-1",
      "agent.runtime_changed",
      "agent",
      "agent-1",
      { from: "strands", to: "flue" },
    );
  });

  it("refuses member-role callers before UPDATE", async () => {
    mockSelectRows.mockReturnValue([
      { tenant_id: "tenant-A", runtime: "strands" },
    ]);
    mockRequireTenantAdmin.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      updateAgentRuntime(null, { id: "agent-1", runtime: "FLUE" }, CTX),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(updateCallRef.value).toBe(0);
  });

  it("does not leak tenant membership when the agent is missing", async () => {
    mockSelectRows.mockReturnValue([]);

    await expect(
      updateAgentRuntime(null, { id: "missing-agent", runtime: "FLUE" }, CTX),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });

    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(updateCallRef.value).toBe(0);
  });

  it("rejects invalid runtime values before UPDATE", async () => {
    mockSelectRows.mockReturnValue([
      { tenant_id: "tenant-A", runtime: "strands" },
    ]);
    mockRequireTenantAdmin.mockResolvedValue("admin");

    await expect(
      updateAgentRuntime(null, { id: "agent-1", runtime: "bogus" }, CTX),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });

    expect(updateCallRef.value).toBe(0);
  });
});
