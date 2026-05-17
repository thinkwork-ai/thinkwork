import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockResolveCaller, mockToGraphqlComputer } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockResolveCaller: vi.fn(),
    mockToGraphqlComputer: vi.fn((row: Record<string, unknown>) => ({
      id: row.id,
      name: row.name,
    })),
  }),
);

vi.mock("../../utils.js", () => ({
  db: { select: mockSelect },
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: "ne", left, right })),
  computers: {
    id: "computers.id",
    status: "computers.status",
  },
  computerAssignments: {
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
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("./shared.js", () => ({
  toGraphqlComputer: mockToGraphqlComputer,
}));

let resolver: typeof import("./assignedComputers.query.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockResolveCaller.mockReset();
  mockToGraphqlComputer.mockClear();
  mockResolveCaller.mockResolvedValue({ userId: "user-1", tenantId: "t1" });
  resolver = await import("./assignedComputers.query.js");
});

describe("assignedComputers", () => {
  it("returns direct and Team-assigned Computers once", async () => {
    mockSelect
      .mockReturnValueOnce(
        queryRows([{ computers: { id: "c1", name: "Sales" } }]),
      )
      .mockReturnValueOnce(
        queryRows([
          { computers: { id: "c1", name: "Sales" } },
          { computers: { id: "c2", name: "Finance" } },
        ]),
      );

    const result = await resolver.assignedComputers(null, {}, {} as any);

    expect(result).toEqual([
      { id: "c1", name: "Sales" },
      { id: "c2", name: "Finance" },
    ]);
  });

  it("fails closed to an empty list when caller identity is unavailable", async () => {
    mockResolveCaller.mockResolvedValueOnce({ userId: null, tenantId: "t1" });

    await expect(
      resolver.assignedComputers(null, {}, {} as any),
    ).resolves.toEqual([]);

    expect(mockSelect).not.toHaveBeenCalled();
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
}
