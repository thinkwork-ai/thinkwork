import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

// Module-load wires in @thinkwork/database-pg/schema; we mock the symbols
// the handler imports rather than the full package surface.
const mocks = vi.hoisted(() => ({
  requireTenantMembership: vi.fn(),
  listSelect: vi.fn(),
  computersSelectByIdLookup: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  getById: vi.fn(),
  hasConnectorTriggerDefinition: vi.fn(),
  prepareConnectorTriggerDefinition: vi.fn(),
}));

vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: mocks.requireTenantMembership,
}));

// Drizzle's chained query builder is faked piece by piece so each test can
// assert against the where-conditions / values sent to the underlying client.
vi.mock("../lib/db.js", () => {
  // Route `select` calls by whether a projection arg was passed:
  //   - `db.select()` (no arg)            → list / getById / refresh-after-insert paths
  //   - `db.select({ tenant_id: ... })`   → computers tenant-validation lookup in createScheduledJob
  const tableHandlers = {
    select: (projection?: unknown) => {
      const isComputerLookup = projection !== undefined;
      return {
        from: (_table: unknown) => ({
          where: (cond: unknown) => {
            const result = {
              then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve(
                  isComputerLookup
                    ? mocks.computersSelectByIdLookup(cond)
                    : mocks.getById(cond),
                ).then(resolve),
              orderBy: () => ({
                limit: () =>
                  Promise.resolve(mocks.listSelect({ projection, cond })),
              }),
            };
            return result;
          },
        }),
      };
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => Promise.resolve(mocks.insert({ table, values })),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: () =>
            Promise.resolve(mocks.update({ table, values, cond })),
        }),
      }),
    }),
  };
  return { db: tableHandlers };
});

vi.mock("../lib/computers/connector-trigger-routing.js", () => ({
  hasConnectorTriggerDefinition: mocks.hasConnectorTriggerDefinition,
  prepareConnectorTriggerDefinition: mocks.prepareConnectorTriggerDefinition,
}));

import { handler } from "./scheduled-jobs.js";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_TENANT_ID = "99999999-9999-9999-9999-999999999999";
const COMPUTER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const FOREIGN_COMPUTER_ID = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const JOB_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant_id: TENANT_ID,
  trigger_type: "manual",
  agent_id: null,
  computer_id: COMPUTER_ID,
  routine_id: null,
  team_id: null,
  name: "Smoke",
  description: null,
  prompt: null,
  config: null,
  schedule_type: null,
  schedule_expression: null,
  timezone: "UTC",
  enabled: true,
  eb_schedule_name: null,
  last_run_at: null,
  next_run_at: null,
  created_by_type: "user",
  created_by_id: null,
  created_at: new Date(),
  updated_at: new Date(),
};

function event(opts: {
  method: "GET" | "POST" | "PUT";
  path?: string;
  queryStringParameters?: Record<string, string>;
  body?: unknown;
}): APIGatewayProxyEventV2 {
  return {
    rawPath: opts.path ?? "/api/scheduled-jobs",
    headers: { "x-tenant-id": TENANT_ID, authorization: "Bearer test" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    queryStringParameters: opts.queryStringParameters ?? {},
    requestContext: { http: { method: opts.method } },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTenantMembership.mockResolvedValue({
    ok: true,
    tenantId: TENANT_ID,
  });
  mocks.listSelect.mockResolvedValue([]);
  mocks.computersSelectByIdLookup.mockResolvedValue([]);
  mocks.insert.mockResolvedValue([JOB_ROW]);
  mocks.update.mockResolvedValue([JOB_ROW]);
  mocks.getById.mockResolvedValue([JOB_ROW]);
  mocks.hasConnectorTriggerDefinition.mockReturnValue(false);
  mocks.prepareConnectorTriggerDefinition.mockResolvedValue({
    triggerType: "event",
    scheduleType: "event",
    computerId: COMPUTER_ID,
    config: {
      connectorTrigger: {
        provider: "google-gmail",
        eventType: "message.created",
        connectionId: "connection-1",
        computerId: COMPUTER_ID,
        requesterUserId: "user-1",
      },
    },
  });
});

describe("scheduled-jobs handler — computer_id filter (GET /api/scheduled-jobs)", () => {
  it("forwards computer_id query param into the where conditions", async () => {
    const response = await handler(
      event({
        method: "GET",
        queryStringParameters: { computer_id: COMPUTER_ID },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(mocks.listSelect).toHaveBeenCalledTimes(1);
  });

  it("intersects computer_id with the tenant filter (returns empty for unknown computer)", async () => {
    mocks.listSelect.mockResolvedValueOnce([]);
    const response = await handler(
      event({
        method: "GET",
        queryStringParameters: {
          computer_id: "00000000-0000-0000-0000-000000000000",
        },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "[]")).toEqual([]);
  });

  it("omits computer_id condition when not provided (backward-compat)", async () => {
    const response = await handler(event({ method: "GET" }));
    expect(response.statusCode).toBe(200);
    expect(mocks.listSelect).toHaveBeenCalledTimes(1);
  });
});

describe("scheduled-jobs handler — POST tenant validation for computer_id", () => {
  it("rejects creates referencing a foreign-tenant computer with 403", async () => {
    mocks.computersSelectByIdLookup.mockResolvedValueOnce([
      { tenant_id: OTHER_TENANT_ID },
    ]);
    const response = await handler(
      event({
        method: "POST",
        body: {
          name: "X",
          trigger_type: "manual",
          computer_id: FOREIGN_COMPUTER_ID,
        },
      }),
    );
    expect(response.statusCode).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects creates referencing a missing computer_id with 400", async () => {
    mocks.computersSelectByIdLookup.mockResolvedValueOnce([]);
    const response = await handler(
      event({
        method: "POST",
        body: {
          name: "X",
          trigger_type: "manual",
          computer_id: "11111111-aaaa-bbbb-cccc-dddddddddddd",
        },
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("accepts creates with a same-tenant computer_id", async () => {
    mocks.computersSelectByIdLookup.mockResolvedValueOnce([
      { tenant_id: TENANT_ID },
    ]);
    const response = await handler(
      event({
        method: "POST",
        body: {
          name: "X",
          trigger_type: "manual",
          computer_id: COMPUTER_ID,
        },
      }),
    );
    expect(response.statusCode).toBe(201);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    const insertedValues = mocks.insert.mock.calls[0]![0]!.values as Record<
      string,
      unknown
    >;
    expect(insertedValues.computer_id).toBe(COMPUTER_ID);
  });

  it("creates without computer_id when none is provided (backward-compat)", async () => {
    const response = await handler(
      event({
        method: "POST",
        body: { name: "X", trigger_type: "manual" },
      }),
    );
    expect(response.statusCode).toBe(201);
    expect(mocks.computersSelectByIdLookup).not.toHaveBeenCalled();
    const insertedValues = mocks.insert.mock.calls[0]![0]!.values as Record<
      string,
      unknown
    >;
    expect(insertedValues.computer_id).toBeNull();
  });

  it("normalizes connector event triggers without provisioning EventBridge", async () => {
    mocks.computersSelectByIdLookup.mockResolvedValueOnce([
      { tenant_id: TENANT_ID },
    ]);
    mocks.hasConnectorTriggerDefinition.mockReturnValueOnce(true);
    mocks.requireTenantMembership.mockResolvedValueOnce({
      ok: true,
      tenantId: TENANT_ID,
      userId: "user-1",
    });

    const response = await handler(
      event({
        method: "POST",
        body: {
          name: "New Gmail",
          trigger_type: "event",
          computer_id: COMPUTER_ID,
          config: {
            provider: "google-gmail",
            eventType: "message.created",
            connectionId: "connection-1",
          },
        },
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(mocks.prepareConnectorTriggerDefinition).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      requesterUserId: "user-1",
      computerId: COMPUTER_ID,
      config: {
        provider: "google-gmail",
        eventType: "message.created",
        connectionId: "connection-1",
      },
    });
    const insertedValues = mocks.insert.mock.calls[0]![0]!.values as Record<
      string,
      unknown
    >;
    expect(insertedValues).toMatchObject({
      trigger_type: "event",
      computer_id: COMPUTER_ID,
      schedule_type: "event",
      created_by_id: "user-1",
    });
  });
});

describe("scheduled-jobs handler — PUT does not re-parent computer_id", () => {
  it("ignores computer_id in the update body", async () => {
    mocks.update.mockResolvedValueOnce([JOB_ROW]);
    const response = await handler(
      event({
        method: "PUT",
        path: "/api/scheduled-jobs/11111111-1111-1111-1111-111111111111",
        body: {
          name: "Edited",
          computer_id: FOREIGN_COMPUTER_ID,
        },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const updateValues = mocks.update.mock.calls[0]![0]!.values as Record<
      string,
      unknown
    >;
    expect(updateValues).not.toHaveProperty("computer_id");
    expect(updateValues.name).toBe("Edited");
  });
});
