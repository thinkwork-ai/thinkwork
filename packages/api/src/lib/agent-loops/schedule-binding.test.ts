import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: vi.fn(),
  insertValues: vi.fn(),
  invokeJobScheduleManager: vi.fn(),
}));

vi.mock("../../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mocks.selectRows(),
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => {
        mocks.insertValues(values);
        return {
          returning: () => Promise.resolve([{ id: "scheduled-1" }]),
        };
      },
    }),
  },
  scheduledJobs: {
    id: "scheduled_jobs.id",
    tenant_id: "scheduled_jobs.tenant_id",
    agent_loop_id: "scheduled_jobs.agent_loop_id",
    space_id: "scheduled_jobs.space_id",
    trigger_type: "scheduled_jobs.trigger_type",
    name: "scheduled_jobs.name",
    description: "scheduled_jobs.description",
    prompt: "scheduled_jobs.prompt",
    agent_id: "scheduled_jobs.agent_id",
    schedule_type: "scheduled_jobs.schedule_type",
    schedule_expression: "scheduled_jobs.schedule_expression",
    timezone: "scheduled_jobs.timezone",
    enabled: "scheduled_jobs.enabled",
  },
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  invokeJobScheduleManager: mocks.invokeJobScheduleManager,
}));

// eslint-disable-next-line import/first
import { syncAgentLoopScheduleBinding } from "./schedule-binding.js";

beforeEach(() => {
  mocks.selectRows.mockReset();
  mocks.insertValues.mockReset();
  mocks.invokeJobScheduleManager.mockReset();
});

describe("syncAgentLoopScheduleBinding", () => {
  it("creates scheduled_jobs plumbing and provisions EventBridge for scheduled loops", async () => {
    mocks.selectRows.mockResolvedValue([]);
    mocks.invokeJobScheduleManager.mockResolvedValue({ ok: true });

    const result = await syncAgentLoopScheduleBinding({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      name: "Weekly Agent Check-In",
      description: "summary",
      goalObjective: "Check blockers",
      workerAgentId: "agent-1",
      spaceId: "space-1",
      loopEnabled: true,
      actorId: "user-1",
      triggerSpec: {
        family: "schedule",
        enabled: true,
        config: {
          scheduleExpression: "rate(7 days)",
          timezone: "America/Chicago",
        },
      },
    });

    expect(result).toEqual({ scheduledJobId: "scheduled-1", changed: true });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        agent_loop_id: "loop-1",
        space_id: "space-1",
        trigger_type: "agent_loop_schedule",
        agent_id: "agent-1",
        schedule_expression: "rate(7 days)",
        timezone: "America/Chicago",
        enabled: true,
      }),
    );
    expect(mocks.invokeJobScheduleManager).toHaveBeenCalledWith(
      "POST",
      expect.objectContaining({
        triggerId: "scheduled-1",
        tenantId: "tenant-1",
        triggerType: "agent_loop_schedule",
        spaceId: "space-1",
        scheduleExpression: "rate(7 days)",
      }),
    );
  });

  it("does not update EventBridge when schedule fields are unchanged", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "scheduled-1",
        name: "Weekly Agent Check-In",
        description: "summary",
        prompt: "Check blockers",
        agent_id: "agent-1",
        space_id: "space-1",
        schedule_type: "rate",
        schedule_expression: "rate(7 days)",
        timezone: "UTC",
        enabled: true,
      },
    ]);

    const result = await syncAgentLoopScheduleBinding({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      name: "Weekly Agent Check-In",
      description: "summary",
      goalObjective: "Check blockers",
      workerAgentId: "agent-1",
      spaceId: "space-1",
      loopEnabled: true,
      triggerSpec: {
        family: "schedule",
        enabled: true,
        config: { scheduleExpression: "rate(7 days)" },
      },
    });

    expect(result).toEqual({ scheduledJobId: "scheduled-1", changed: false });
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.invokeJobScheduleManager).not.toHaveBeenCalled();
  });

  it("disables an existing schedule when the loop moves back to manual", async () => {
    mocks.selectRows.mockResolvedValue([
      {
        id: "scheduled-1",
        enabled: true,
      },
    ]);
    mocks.invokeJobScheduleManager.mockResolvedValue({ ok: true });

    const result = await syncAgentLoopScheduleBinding({
      tenantId: "tenant-1",
      agentLoopId: "loop-1",
      name: "Manual Loop",
      goalObjective: "Run only on demand",
      workerAgentId: null,
      loopEnabled: true,
      triggerSpec: {
        family: "manual",
        enabled: true,
        config: {},
      },
    });

    expect(result).toEqual({ scheduledJobId: "scheduled-1", changed: true });
    expect(mocks.invokeJobScheduleManager).toHaveBeenCalledWith("PUT", {
      triggerId: "scheduled-1",
      tenantId: "tenant-1",
      enabled: false,
    });
  });
});
