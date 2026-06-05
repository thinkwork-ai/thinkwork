import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
}));

function queryChain() {
  const rows = () => Promise.resolve(mocks.rows.shift() ?? []);
  const chain = {
    from: () => chain,
    where: () => chain,
    groupBy: () => rows(),
    then: (
      resolve: (value: Array<Record<string, unknown>>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => rows().then(resolve, reject),
  };
  return chain;
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => queryChain(),
  },
  costEvents: {
    tenant_id: "cost_events.tenant_id",
    user_id: "cost_events.user_id",
    created_at: "cost_events.created_at",
  },
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
    name: "users.name",
    email: "users.email",
  },
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  gte: (...args: unknown[]) => ({ _gte: args }),
  lte: (...args: unknown[]) => ({ _lte: args }),
  inArray: (...args: unknown[]) => ({ _inArray: args }),
  sql: () => "sql",
  startOfMonth: () => new Date("2026-06-01T00:00:00.000Z"),
}));

// eslint-disable-next-line import/first
import { costByUser } from "./costByUser.query.js";

beforeEach(() => {
  mocks.rows = [];
});

describe("costByUser", () => {
  it("returns sorted user rows plus a visible system bucket for unattributed spend", async () => {
    mocks.rows = [
      [
        { userId: "user-low", totalUsd: 2.5, eventCount: 3 },
        { userId: null, totalUsd: 7.25, eventCount: 4 },
        { userId: "user-high", totalUsd: 12.75, eventCount: 9 },
      ],
      [
        { id: "user-high", name: "Lin", email: "lin@example.com" },
        { id: "user-low", name: null, email: "low@example.com" },
      ],
    ];

    await expect(
      costByUser(
        null,
        {
          tenantId: "tenant-1",
          from: "2026-06-01T00:00:00.000Z",
          to: "2026-06-30T23:59:59.000Z",
        },
        {} as any,
      ),
    ).resolves.toEqual([
      {
        userId: "user-high",
        userName: "Lin",
        userEmail: "lin@example.com",
        totalUsd: 12.75,
        eventCount: 9,
        isSystem: false,
      },
      {
        userId: null,
        userName: "System / unattributed",
        userEmail: null,
        totalUsd: 7.25,
        eventCount: 4,
        isSystem: true,
      },
      {
        userId: "user-low",
        userName: "low@example.com",
        userEmail: "low@example.com",
        totalUsd: 2.5,
        eventCount: 3,
        isSystem: false,
      },
    ]);
  });
});
