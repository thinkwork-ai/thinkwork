import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    op: "inArray",
    left,
    right,
  })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: "ne", left, right })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    strings,
    values,
  })),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: mockSelect,
    insert: () => ({ values: vi.fn() }),
    update: () => ({ set: vi.fn() }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  computers: table("computers", ["id", "tenant_id", "owner_user_id", "status"]),
  computerAssignments: table("computer_assignments", [
    "id",
    "tenant_id",
    "computer_id",
    "subject_type",
    "user_id",
    "team_id",
  ]),
  computerEvents: table("computer_events", ["id"]),
  computerTasks: table("computer_tasks", ["id"]),
  messages: table("messages", ["id"]),
  teamUsers: table("team_users", ["tenant_id", "team_id", "user_id"]),
  threadAttachments: table("thread_attachments", ["id"]),
  threads: table("threads", ["id"]),
}));

vi.mock("../../graphql/utils.js", () => ({
  invokeChatAgent: vi.fn(),
}));

vi.mock("../../graphql/notify.js", () => ({
  notifyNewMessage: vi.fn(),
  notifyThreadUpdate: vi.fn(),
}));

let resolver: typeof import("./thread-cutover.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  resolver = await import("./thread-cutover.js");
});

describe("resolveThreadComputer assignment routing", () => {
  it("allows a requester with a direct shared-Computer assignment", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows([{ id: "c1", owner_user_id: null }]))
      .mockReturnValueOnce(queryRows([{ id: "assignment-1" }]));

    await expect(
      resolver.resolveThreadComputer({
        tenantId: "t1",
        requesterUserId: "user-1",
        requestedComputerId: "c1",
      }),
    ).resolves.toEqual({ id: "c1", owner_user_id: null });
  });

  it("allows a requester with a team shared-Computer assignment", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows([{ id: "c1", owner_user_id: null }]))
      .mockReturnValueOnce(queryRows([]))
      .mockReturnValueOnce(queryRows([{ id: "assignment-team-1" }]));

    await expect(
      resolver.resolveThreadComputer({
        tenantId: "t1",
        requesterUserId: "user-1",
        requestedComputerId: "c1",
      }),
    ).resolves.toEqual({ id: "c1", owner_user_id: null });
  });

  it("rejects an unassigned requester for a shared Computer", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows([{ id: "c1", owner_user_id: null }]))
      .mockReturnValueOnce(queryRows([]))
      .mockReturnValueOnce(queryRows([]));

    await expect(
      resolver.resolveThreadComputer({
        tenantId: "t1",
        requesterUserId: "user-1",
        requestedComputerId: "c1",
      }),
    ).rejects.toThrow("Computer is not assigned to requester");
  });
});

function table(name: string, columns: string[]) {
  return Object.fromEntries(
    columns.map((column) => [column, `${name}.${column}`]),
  );
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
