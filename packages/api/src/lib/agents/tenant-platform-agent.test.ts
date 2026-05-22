import { beforeEach, describe, expect, it, vi } from "vitest";

const { rowsQueue, whereCalls } = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  whereCalls: [] as unknown[],
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (pred: unknown) => ({
          __capture: whereCalls.push(pred),
          limit: async () => rowsQueue.shift() ?? [],
        }),
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    is_platform_default: "agents.is_platform_default",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
}));

import {
  MultiplePlatformAgentsError,
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "./tenant-platform-agent.js";

const TENANT_ID = "tenant-1";

beforeEach(() => {
  rowsQueue.length = 0;
  whereCalls.length = 0;
});

describe("resolveTenantPlatformAgent", () => {
  it("returns the tenant platform default agent", async () => {
    rowsQueue.push([{ id: "agent-platform", is_platform_default: true }]);

    await expect(resolveTenantPlatformAgent(TENANT_ID)).resolves.toMatchObject({
      id: "agent-platform",
    });
    expect(whereCalls[0]).toEqual({
      op: "and",
      preds: [
        { op: "eq", col: "agents.tenant_id", val: TENANT_ID },
        { op: "eq", col: "agents.is_platform_default", val: true },
      ],
    });
  });

  it("throws when no platform agent has been marked for the tenant", async () => {
    rowsQueue.push([]);

    await expect(resolveTenantPlatformAgent(TENANT_ID)).rejects.toBeInstanceOf(
      PlatformAgentNotFoundError,
    );
  });

  it("throws defensively when more than one platform agent is returned", async () => {
    rowsQueue.push([
      { id: "agent-a", is_platform_default: true },
      { id: "agent-b", is_platform_default: true },
    ]);

    await expect(resolveTenantPlatformAgent(TENANT_ID)).rejects.toBeInstanceOf(
      MultiplePlatformAgentsError,
    );
  });
});
