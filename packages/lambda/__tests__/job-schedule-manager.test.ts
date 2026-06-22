import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSchedulerSend,
  mockDbSelectRows,
  mockDbUpdateSet,
  mockDbUpdateReturning,
} = vi.hoisted(() => ({
  mockSchedulerSend: vi.fn(),
  mockDbSelectRows: vi.fn(),
  mockDbUpdateSet: vi.fn(),
  mockDbUpdateReturning: vi.fn(),
}));

const selectChain = () => ({
  from: () => ({
    where: () => Promise.resolve(mockDbSelectRows()),
  }),
});

const updateChain = () => ({
  set: (value: Record<string, unknown>) => {
    mockDbUpdateSet(value);
    return {
      where: () => ({
        returning: () => Promise.resolve(mockDbUpdateReturning()),
      }),
    };
  },
});

vi.mock("@thinkwork/runtime-config", () => ({
  getApiAuthSecret: () => "test-secret",
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => selectChain(),
    update: () => updateChain(),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  triggers: {
    id: "scheduled_jobs.id",
  },
}));

vi.mock("@aws-sdk/client-scheduler", () => {
  class MockSchedulerClient {
    send(command: unknown) {
      return mockSchedulerSend(command);
    }
  }
  class MockUpdateScheduleCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    SchedulerClient: MockSchedulerClient,
    CreateScheduleCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
    DeleteScheduleCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
    UpdateScheduleCommand: MockUpdateScheduleCommand,
    GetScheduleCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
    ListSchedulesCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
    CreateScheduleGroupCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
    ScheduleState: {
      ENABLED: "ENABLED",
      DISABLED: "DISABLED",
    },
  };
});

describe("job-schedule-manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOB_TRIGGER_ARN =
      "arn:aws:lambda:us-east-1:123456789012:function:job-trigger";
    process.env.JOB_TRIGGER_ROLE_ARN =
      "arn:aws:iam::123456789012:role/job-trigger";
    mockSchedulerSend.mockResolvedValue({});
  });

  it("persists updated agent bindings and refreshes the EventBridge target payload", async () => {
    mockDbSelectRows.mockReturnValue([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        trigger_type: "agent_loop_schedule",
        agent_id: "agent-old",
        space_id: null,
        routine_id: null,
        prompt: "old prompt",
        schedule_type: "cron",
        schedule_expression: "cron(0 8 * * ? *)",
        timezone: "UTC",
        enabled: true,
        eb_schedule_name: "job-job-1",
        name: "Old name",
      },
    ]);
    mockDbUpdateReturning.mockReturnValue([
      {
        id: "job-1",
        agent_id: "agent-new",
      },
    ]);

    const { handler } = await import("../job-schedule-manager.js");
    const response = await handler({
      requestContext: { http: { method: "PUT" } },
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({
        triggerId: "job-1",
        agentId: "agent-new",
        prompt: "updated prompt",
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(mockDbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: "agent-new",
        prompt: "updated prompt",
      }),
    );

    const updateCommand = mockSchedulerSend.mock.calls[0]?.[0] as {
      input?: { Target?: { Input?: string } };
    };
    expect(updateCommand.input?.Target?.Input).toBeDefined();
    const targetPayload = JSON.parse(
      updateCommand.input?.Target?.Input ?? "{}",
    );
    expect(targetPayload).toMatchObject({
      triggerId: "job-1",
      triggerType: "agent_loop_schedule",
      tenantId: "tenant-1",
      agentId: "agent-new",
      prompt: "updated prompt",
    });
  });
});
