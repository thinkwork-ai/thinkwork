import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockRequireTenantAdmin } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: { select: mockSelect },
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: "ne", left, right })),
  users: { id: "users.id" },
  teams: { id: "teams.id" },
  computers: {
    id: "computers.id",
    tenant_id: "computers.tenant_id",
    status: "computers.status",
    $inferSelect: {},
  },
  teamUsers: {
    tenant_id: "team_users.tenant_id",
    team_id: "team_users.team_id",
    user_id: "team_users.user_id",
  },
  computerAssignments: {
    tenant_id: "computer_assignments.tenant_id",
    computer_id: "computer_assignments.computer_id",
    subject_type: "computer_assignments.subject_type",
    user_id: "computer_assignments.user_id",
    team_id: "computer_assignments.team_id",
  },
  snakeToCamel: (row: Record<string, unknown>) => row,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("./shared.js", () => ({
  accessSource: ({ direct, team }: { direct: boolean; team: boolean }) =>
    direct && team ? "BOTH" : team ? "TEAM" : "DIRECT",
  toGraphqlComputer: (row: Record<string, unknown>) => ({
    id: row.id,
    name: row.name,
  }),
  toGraphqlComputerAssignment: (row: Record<string, unknown>) => ({
    id: row.id,
    subjectType: String(row.subject_type).toUpperCase(),
  }),
}));

let resolver: typeof import("./userComputerAssignments.query.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockRequireTenantAdmin.mockReset();
  resolver = await import("./userComputerAssignments.query.js");
});

describe("userComputerAssignments", () => {
  it("returns direct and Team-derived Computer access for a user", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows([{ id: "u1", tenant_id: "t1" }]))
      .mockReturnValueOnce(
        queryRows([
          {
            computers: { id: "c1", name: "Finance" },
            computer_assignments: { id: "direct-1", subject_type: "user" },
          },
        ]),
      )
      .mockReturnValueOnce(
        queryRows([
          {
            computers: { id: "c1", name: "Finance" },
            teams: { id: "team-1", name: "Finance Team" },
            computer_assignments: { id: "team-1", subject_type: "team" },
          },
          {
            computers: { id: "c2", name: "Sales" },
            teams: { id: "team-2", name: "Sales Team" },
            computer_assignments: { id: "team-2", subject_type: "team" },
          },
        ]),
      );

    const result = await resolver.userComputerAssignments(
      null,
      { userId: "u1" },
      {} as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith({}, "t1");
    expect(result).toEqual([
      {
        computerId: "c1",
        computer: { id: "c1", name: "Finance" },
        accessSource: "BOTH",
        directAssignment: { id: "direct-1", subjectType: "USER" },
        teamAssignments: [{ id: "team-1", subjectType: "TEAM" }],
        teams: [{ id: "team-1", name: "Finance Team" }],
      },
      {
        computerId: "c2",
        computer: { id: "c2", name: "Sales" },
        accessSource: "TEAM",
        directAssignment: null,
        teamAssignments: [{ id: "team-2", subjectType: "TEAM" }],
        teams: [{ id: "team-2", name: "Sales Team" }],
      },
    ]);
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}
