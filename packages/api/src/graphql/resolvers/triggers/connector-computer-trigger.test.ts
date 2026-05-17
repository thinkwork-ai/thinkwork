import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  invokeJobScheduleManager: vi.fn(),
  resolveCallerFromAuth: vi.fn(),
  hasConnectorTriggerDefinition: vi.fn(),
  prepareConnectorTriggerDefinition: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: mocks.db,
  scheduledJobs: {
    id: "scheduled_jobs.id",
  },
  computers: {
    id: "computers.id",
    tenant_id: "computers.tenant_id",
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  snakeToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    triggerType: row.trigger_type,
    computerId: row.computer_id,
    config: row.config,
    scheduleType: row.schedule_type,
  }),
  invokeJobScheduleManager: mocks.invokeJobScheduleManager,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));

vi.mock("../../../lib/computers/connector-trigger-routing.js", () => ({
  hasConnectorTriggerDefinition: mocks.hasConnectorTriggerDefinition,
  prepareConnectorTriggerDefinition: mocks.prepareConnectorTriggerDefinition,
}));

let resolver: typeof import("./createScheduledJob.mutation.js");
let insertedValues: Record<string, unknown>;

beforeEach(async () => {
  vi.resetModules();
  mocks.db.select.mockReset();
  mocks.db.insert.mockReset();
  mocks.invokeJobScheduleManager.mockReset();
  mocks.resolveCallerFromAuth.mockReset();
  mocks.hasConnectorTriggerDefinition.mockReset();
  mocks.prepareConnectorTriggerDefinition.mockReset();
  insertedValues = {};

  mocks.resolveCallerFromAuth.mockResolvedValue({ userId: "user-1" });
  mocks.hasConnectorTriggerDefinition.mockReturnValue(true);
  mocks.prepareConnectorTriggerDefinition.mockResolvedValue({
    triggerType: "event",
    scheduleType: "event",
    computerId: "computer-1",
    config: {
      connectorTrigger: {
        provider: "google-gmail",
        eventType: "message.created",
        connectionId: "connection-1",
        computerId: "computer-1",
        requesterUserId: "user-1",
      },
    },
  });
  mocks.db.select
    .mockReturnValueOnce(queryRows([{ tenant_id: "tenant-1" }]))
    .mockReturnValueOnce(
      queryRows([
        {
          id: "trigger-1",
          tenant_id: "tenant-1",
          trigger_type: "event",
          computer_id: "computer-1",
          config: {
            connectorTrigger: {
              provider: "google-gmail",
              eventType: "message.created",
              connectionId: "connection-1",
              computerId: "computer-1",
              requesterUserId: "user-1",
            },
          },
          schedule_type: "event",
        },
      ]),
    );
  mocks.db.insert.mockReturnValue({
    values: (values: Record<string, unknown>) => {
      insertedValues = values;
      return {
        returning: () =>
          Promise.resolve([
            {
              id: "trigger-1",
              tenant_id: "tenant-1",
              trigger_type: values.trigger_type,
              computer_id: values.computer_id,
              config: values.config,
              schedule_type: values.schedule_type,
            },
          ]),
      };
    },
  });

  resolver = await import("./createScheduledJob.mutation.js");
});

describe("createScheduledJob connector triggers", () => {
  it("creates event connector triggers for shared Computers without EventBridge provisioning", async () => {
    const result = await resolver.createScheduledJob(
      null,
      {
        input: {
          tenantId: "tenant-1",
          triggerType: "event",
          computerId: "computer-1",
          name: "New Gmail",
          config: JSON.stringify({
            provider: "google-gmail",
            eventType: "message.created",
            connectionId: "connection-1",
          }),
        },
      },
      { auth: {} } as any,
    );

    expect(mocks.prepareConnectorTriggerDefinition).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      requesterUserId: "user-1",
      computerId: "computer-1",
      config: {
        provider: "google-gmail",
        eventType: "message.created",
        connectionId: "connection-1",
      },
    });
    expect(insertedValues).toMatchObject({
      tenant_id: "tenant-1",
      trigger_type: "event",
      computer_id: "computer-1",
      schedule_type: "event",
      created_by_type: "user",
      created_by_id: "user-1",
    });
    expect(insertedValues.config).toEqual({
      connectorTrigger: {
        provider: "google-gmail",
        eventType: "message.created",
        connectionId: "connection-1",
        computerId: "computer-1",
        requesterUserId: "user-1",
      },
    });
    expect(mocks.invokeJobScheduleManager).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: "trigger-1",
        triggerType: "event",
        computerId: "computer-1",
        scheduleType: "event",
      }),
    );
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}
