import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockUpdateSet, mockReturning } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockReturning: vi.fn(),
}));

const updateChain = () => ({
  set: (value: Record<string, unknown>) => {
    mockUpdateSet(value);
    return {
      where: () => ({
        returning: (shape: Record<string, unknown>) => mockReturning(shape),
      }),
    };
  },
});

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: (table: unknown) => {
      mockUpdate(table);
      return updateChain();
    },
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    id: "agents.id",
    budget_paused: "agents.budget_paused",
    budget_paused_at: "agents.budget_paused_at",
    budget_paused_reason: "agents.budget_paused_reason",
  },
  scheduledJobs: {
    id: "scheduled_jobs.id",
    budget_paused: "scheduled_jobs.budget_paused",
    budget_paused_at: "scheduled_jobs.budget_paused_at",
    budget_paused_reason: "scheduled_jobs.budget_paused_reason",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _eq: args }),
}));

describe("budget-reset cron", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:05:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears agent and scheduled-job budget pause state on the first day of the month", async () => {
    mockReturning
      .mockResolvedValueOnce([{ id: "agent-1" }])
      .mockResolvedValueOnce([{ id: "job-1" }, { id: "job-2" }]);
    const { handler } = await import("./budget-reset.js");

    await expect(handler()).resolves.toEqual({ reset: true, count: 3 });

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenNthCalledWith(1, {
      budget_paused: false,
      budget_paused_at: null,
      budget_paused_reason: null,
    });
    expect(mockUpdateSet).toHaveBeenNthCalledWith(2, {
      budget_paused: false,
      budget_paused_at: null,
      budget_paused_reason: null,
    });
  });

  it("does not mutate pause state on other days", async () => {
    vi.setSystemTime(new Date("2026-06-02T00:05:00.000Z"));
    const { handler } = await import("./budget-reset.js");

    await expect(handler()).resolves.toEqual({ reset: false, count: 0 });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});
