import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  invocations: [] as Array<{ method: string; body: Record<string, unknown> }>,
  invokeResults: [] as Array<{ ok: true } | { ok: false; error: string }>,
}));

vi.mock("../../graphql/utils.js", () => ({
  db: {
    select: () => {
      const resolve = () => Promise.resolve(mocks.selectQueue.shift() ?? []);
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => resolve(),
      };
      return chain;
    },
  },
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  scheduledJobs: {
    id: "id",
    enabled: "enabled",
    tenant_id: "tenant_id",
    workflow_id: "workflow_id",
    trigger_type: "trigger_type",
  },
  invokeJobScheduleManager: vi.fn(
    async (method: string, body: Record<string, unknown>) => {
      mocks.invocations.push({ method, body });
      return mocks.invokeResults.shift() ?? { ok: true };
    },
  ),
}));

const { syncWorkflowScheduleBinding } = await import("./schedule-binding.js");

const BASE = {
  tenantId: "tenant-1",
  workflowId: "wf-1",
  name: "Daily report",
  description: null,
  actorId: "user-1",
};

const SCHEDULE = {
  scheduleExpression: "cron(0 9 * * ? *)",
  timezone: "America/Chicago",
  enabled: true,
};

beforeEach(() => {
  mocks.selectQueue.length = 0;
  mocks.invocations.length = 0;
  mocks.invokeResults.length = 0;
});

describe("syncWorkflowScheduleBinding", () => {
  it("updates an existing binding with triggerId — the manager's PUT contract (U12 AE6 regression)", async () => {
    mocks.selectQueue.push([{ id: "sj-1", enabled: true }]);
    const result = await syncWorkflowScheduleBinding({
      ...BASE,
      schedule: SCHEDULE,
    });
    expect(result).toEqual({ scheduledJobId: "sj-1", changed: true });
    expect(mocks.invocations).toHaveLength(1);
    const { method, body } = mocks.invocations[0];
    expect(method).toBe("PUT");
    expect(body.triggerId).toBe("sj-1");
    expect(body).not.toHaveProperty("id");
    expect(body.scheduleExpression).toBe("cron(0 9 * * ? *)");
    expect(body.timezone).toBe("America/Chicago");
  });

  it("throws when the update PUT reports failure instead of swallowing it", async () => {
    mocks.selectQueue.push([{ id: "sj-1", enabled: true }]);
    mocks.invokeResults.push({ ok: false, error: "triggerId is required" });
    await expect(
      syncWorkflowScheduleBinding({ ...BASE, schedule: SCHEDULE }),
    ).rejects.toThrow(/schedule update failed: triggerId is required/);
  });

  it("creates via POST, throws on provisioning failure, and re-selects the created row id", async () => {
    // First select: no existing binding. Second select: the row the manager created.
    mocks.selectQueue.push([], [{ id: "sj-new" }]);
    const result = await syncWorkflowScheduleBinding({
      ...BASE,
      schedule: SCHEDULE,
    });
    expect(result).toEqual({ scheduledJobId: "sj-new", changed: true });
    expect(mocks.invocations[0].method).toBe("POST");
    expect(mocks.invocations[0].body).not.toHaveProperty("triggerId");

    mocks.selectQueue.push([]);
    mocks.invokeResults.push({ ok: false, error: "eventbridge denied" });
    await expect(
      syncWorkflowScheduleBinding({ ...BASE, schedule: SCHEDULE }),
    ).rejects.toThrow(/could not be provisioned: eventbridge denied/);
  });

  it("disables with triggerId when the trigger is removed, and throws on failure", async () => {
    mocks.selectQueue.push([{ id: "sj-1", enabled: true }]);
    const result = await syncWorkflowScheduleBinding({
      ...BASE,
      schedule: null,
    });
    expect(result).toEqual({ scheduledJobId: "sj-1", changed: true });
    expect(mocks.invocations[0].method).toBe("PUT");
    expect(mocks.invocations[0].body).toMatchObject({
      triggerId: "sj-1",
      enabled: false,
    });

    mocks.selectQueue.push([{ id: "sj-1", enabled: true }]);
    mocks.invokeResults.push({ ok: false, error: "boom" });
    await expect(
      syncWorkflowScheduleBinding({ ...BASE, schedule: null }),
    ).rejects.toThrow(/schedule disable failed: boom/);
  });

  it("no-ops when there is no trigger and no existing binding", async () => {
    mocks.selectQueue.push([]);
    const result = await syncWorkflowScheduleBinding({
      ...BASE,
      schedule: null,
    });
    expect(result).toEqual({ scheduledJobId: null, changed: false });
    expect(mocks.invocations).toHaveLength(0);
  });
});
