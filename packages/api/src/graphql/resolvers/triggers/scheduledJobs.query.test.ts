import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  rows: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => mocks.rows(),
          }),
        }),
      }),
    }),
  },
  scheduledJobs: {
    tenant_id: "scheduled_jobs.tenant_id",
    agent_id: "scheduled_jobs.agent_id",
    space_id: "scheduled_jobs.space_id",
    computer_id: "scheduled_jobs.computer_id",
    routine_id: "scheduled_jobs.routine_id",
    trigger_type: "scheduled_jobs.trigger_type",
    enabled: "scheduled_jobs.enabled",
    config: "scheduled_jobs.config",
    created_at: "scheduled_jobs.created_at",
  },
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  desc: vi.fn((column: unknown) => ({ op: "desc", column })),
  eq: mocks.eq,
  snakeToCamel: vi.fn((row: unknown) => row),
  sql: vi.fn(),
}));

import { scheduledJobs_ } from "./scheduledJobs.query.js";

beforeEach(() => {
  mocks.eq.mockClear();
  mocks.rows.mockResolvedValue([]);
});

describe("scheduledJobs query", () => {
  it("filters by Space when spaceId is provided", async () => {
    await scheduledJobs_(
      null,
      { tenantId: "tenant-1", spaceId: "space-1", limit: 10 },
      {} as any,
    );

    expect(mocks.eq).toHaveBeenCalledWith(
      "scheduled_jobs.tenant_id",
      "tenant-1",
    );
    expect(mocks.eq).toHaveBeenCalledWith("scheduled_jobs.space_id", "space-1");
  });
});
