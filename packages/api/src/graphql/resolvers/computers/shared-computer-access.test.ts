import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockRequireTenantMember,
  mockRequireTenantAdmin,
  mockResolveCaller,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCaller: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: { select: mockSelect },
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  computers: { $inferSelect: {} },
  computerAssignments: {
    id: "computer_assignments.id",
    tenant_id: "computer_assignments.tenant_id",
    computer_id: "computer_assignments.computer_id",
    subject_type: "computer_assignments.subject_type",
    user_id: "computer_assignments.user_id",
    team_id: "computer_assignments.team_id",
  },
  teamUsers: {
    tenant_id: "team_users.tenant_id",
    team_id: "team_users.team_id",
    user_id: "team_users.user_id",
  },
  agents: {},
  agentTemplates: {},
  users: {},
  teams: {},
  computerToCamel: (row: Record<string, unknown>) => row,
  snakeToCamel: (row: Record<string, unknown>) => row,
  generateSlug: () => "slug",
  isNull: vi.fn(),
  ne: vi.fn(),
  or: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

let shared: typeof import("./shared.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockRequireTenantMember.mockReset();
  mockRequireTenantAdmin.mockReset();
  mockResolveCaller.mockReset();

  mockResolveCaller.mockResolvedValue({ userId: "user-1", tenantId: "t1" });
  shared = await import("./shared.js");
});

describe("requireComputerReadAccess", () => {
  it("allows the historical owner without requiring admin", async () => {
    await shared.requireComputerReadAccess({} as any, computerRow("user-1"));

    expect(mockRequireTenantMember).toHaveBeenCalledWith({}, "t1");
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
  });

  it("allows a directly assigned user without requiring admin", async () => {
    mockSelect.mockReturnValueOnce(queryRows([{ id: "assignment-1" }]));

    await shared.requireComputerReadAccess({} as any, computerRow(null));

    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
  });

  it("falls back to the tenant admin gate when the user is not assigned", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows([]))
      .mockReturnValueOnce(queryRows([]));

    await shared.requireComputerReadAccess({} as any, computerRow(null));

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "t1");
  });
});

function computerRow(ownerUserId: string | null) {
  return {
    id: "c1",
    tenant_id: "t1",
    owner_user_id: ownerUserId,
  } as any;
}

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}
