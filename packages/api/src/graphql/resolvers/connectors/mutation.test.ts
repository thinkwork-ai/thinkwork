import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.fn();
const mockRequireTenantAdmin = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockValues = vi.fn();
const mockSet = vi.fn();
const mockReturning = vi.fn();
const mockRunConnectorDispatchTick = vi.fn();

vi.mock("../../utils.js", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
  snakeToCamel: (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    return out;
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
  },
  connections: {
    id: "connections.id",
    tenant_id: "connections.tenant_id",
  },
  connectors: {
    id: "connectors.id",
    tenant_id: "connectors.tenant_id",
    dispatch_target_type: "connectors.dispatch_target_type",
    dispatch_target_id: "connectors.dispatch_target_id",
  },
  routines: {
    id: "routines.id",
    tenant_id: "routines.tenant_id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../../../lib/connectors/runtime.js", () => ({
  runConnectorDispatchTick: mockRunConnectorDispatchTick,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

let resolvers: typeof import("./mutation.js");

beforeEach(async () => {
  mockRows.mockReset();
  mockRequireTenantAdmin.mockReset();
  mockSelect.mockReset();
  mockInsert.mockReset();
  mockUpdate.mockReset();
  mockFrom.mockReset();
  mockWhere.mockReset();
  mockLimit.mockReset();
  mockValues.mockReset();
  mockSet.mockReset();
  mockReturning.mockReset();
  mockRunConnectorDispatchTick.mockReset();
  vi.resetModules();

  mockRequireTenantAdmin.mockResolvedValue(undefined);
  mockRunConnectorDispatchTick.mockResolvedValue([]);
  mockLimit.mockImplementation(() => Promise.resolve(mockRows()));
  mockWhere.mockReturnValue({ limit: mockLimit, returning: mockReturning });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockReturning.mockImplementation(() => Promise.resolve(mockRows()));
  mockValues.mockReturnValue({ returning: mockReturning });
  mockInsert.mockReturnValue({ values: mockValues });
  mockSet.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });

  resolvers = await import("./mutation.js");
});

describe("connector mutations", () => {
  it("creates a connector after tenant-admin gate and same-tenant target validation", async () => {
    mockRows.mockReturnValueOnce([{ id: "agent-1" }]).mockReturnValueOnce([
      {
        id: "connector-1",
        tenant_id: "tenant-a",
        type: "linear_tracker",
        name: "Linear",
        status: "active",
        enabled: true,
        config: { projectId: "ENG" },
        dispatch_target_type: "agent",
        dispatch_target_id: "agent-1",
      },
    ]);

    const result = await resolvers.createConnector(
      null,
      {
        input: {
          tenantId: "tenant-a",
          type: "linear_tracker",
          name: "Linear",
          config: '{"projectId":"ENG"}',
          dispatchTargetType: "agent",
          dispatchTargetId: "agent-1",
        },
      },
      { auth: { principalId: "user-1", email: "a@example.com" } } as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-a",
    );
    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["agents.id", "agent-1"] },
        { eq: ["agents.tenant_id", "tenant-a"] },
      ],
    });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-a",
        type: "linear_tracker",
        name: "Linear",
        config: { projectId: "ENG" },
        dispatch_target_type: "agent",
        dispatch_target_id: "agent-1",
        enabled: true,
      }),
    );
    expect(result).toMatchObject({
      id: "connector-1",
      tenantId: "tenant-a",
      dispatchTargetType: "agent",
      dispatchTargetId: "agent-1",
    });
  });

  it("updates a connector using row-derived tenant authorization", async () => {
    mockRows
      .mockReturnValueOnce([
        {
          id: "connector-1",
          tenant_id: "tenant-a",
          dispatch_target_type: "agent",
          dispatch_target_id: "agent-1",
        },
      ])
      .mockReturnValueOnce([{ id: "routine-1" }])
      .mockReturnValueOnce([
        {
          id: "connector-1",
          tenant_id: "tenant-a",
          name: "Linear updated",
          dispatch_target_type: "routine",
          dispatch_target_id: "routine-1",
        },
      ]);

    await resolvers.updateConnector(
      null,
      {
        id: "connector-1",
        input: {
          name: "Linear updated",
          dispatchTargetType: "routine",
          dispatchTargetId: "routine-1",
        },
      },
      { auth: { principalId: "user-1" } } as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-a",
    );
    expect(mockWhere).toHaveBeenNthCalledWith(2, {
      and: [
        { eq: ["routines.id", "routine-1"] },
        { eq: ["routines.tenant_id", "tenant-a"] },
      ],
    });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Linear updated",
        dispatch_target_type: "routine",
        dispatch_target_id: "routine-1",
        updated_at: expect.any(Date),
      }),
    );
  });

  it("archives a connector as an idempotent lifecycle update", async () => {
    mockRows
      .mockReturnValueOnce([
        {
          id: "connector-1",
          tenant_id: "tenant-a",
          dispatch_target_type: "agent",
          dispatch_target_id: "agent-1",
        },
      ])
      .mockReturnValueOnce([
        {
          id: "connector-1",
          tenant_id: "tenant-a",
          status: "archived",
          enabled: false,
        },
      ]);

    const result = await resolvers.archiveConnector(
      null,
      { id: "connector-1" },
      { auth: { principalId: "user-1" } } as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-a",
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "archived",
        enabled: false,
        updated_at: expect.any(Date),
      }),
    );
    expect(result).toMatchObject({ status: "archived", enabled: false });
  });

  it("runs a connector now after row-derived tenant authorization", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "connector-1",
        tenant_id: "tenant-a",
        dispatch_target_type: "agent",
        dispatch_target_id: "agent-1",
      },
    ]);
    mockRunConnectorDispatchTick.mockResolvedValueOnce([
      {
        status: "dispatched",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "linear-issue-1",
        threadId: "thread-1",
        messageId: "message-1",
      },
    ]);

    const result = await resolvers.runConnectorNow(
      null,
      { id: "connector-1" },
      { auth: { principalId: "user-1" } } as any,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-a",
    );
    expect(mockRunConnectorDispatchTick).toHaveBeenCalledWith({
      connectorId: "connector-1",
      tenantId: "tenant-a",
      limit: 1,
      force: true,
    });
    expect(result).toEqual({
      connectorId: "connector-1",
      results: [
        {
          status: "dispatched",
          connectorId: "connector-1",
          executionId: "execution-1",
          externalRef: "linear-issue-1",
          threadId: "thread-1",
          messageId: "message-1",
          targetType: null,
          reason: null,
          error: null,
        },
      ],
    });
  });

  it("rejects cross-tenant dispatch targets before inserting", async () => {
    mockRows.mockReturnValueOnce([]);

    await expect(
      resolvers.createConnector(
        null,
        {
          input: {
            tenantId: "tenant-a",
            type: "linear_tracker",
            name: "Linear",
            dispatchTargetType: "agent",
            dispatchTargetId: "agent-b",
          },
        },
        { auth: { principalId: "user-1" } } as any,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant connections before inserting", async () => {
    mockRows.mockReturnValueOnce([{ id: "agent-1" }]).mockReturnValueOnce([]);

    await expect(
      resolvers.createConnector(
        null,
        {
          input: {
            tenantId: "tenant-a",
            type: "linear_tracker",
            name: "Linear",
            connectionId: "connection-b",
            dispatchTargetType: "agent",
            dispatchTargetId: "agent-1",
          },
        },
        { auth: { principalId: "user-1" } } as any,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
    expect(mockWhere).toHaveBeenLastCalledWith({
      and: [
        { eq: ["connections.id", "connection-b"] },
        { eq: ["connections.tenant_id", "tenant-a"] },
      ],
    });
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for unknown connector updates before auth or write", async () => {
    mockRows.mockReturnValueOnce([]);

    await expect(
      resolvers.updateConnector(
        null,
        { id: "missing", input: { name: "Nope" } },
        { auth: { principalId: "user-1" } } as any,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" },
    });
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON config before writing", async () => {
    mockRows.mockReturnValueOnce([{ id: "agent-1" }]);

    await expect(
      resolvers.createConnector(
        null,
        {
          input: {
            tenantId: "tenant-a",
            type: "linear_tracker",
            name: "Linear",
            config: "{nope",
            dispatchTargetType: "agent",
            dispatchTargetId: "agent-1",
          },
        },
        { auth: { principalId: "user-1" } } as any,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
    expect(mockValues).not.toHaveBeenCalled();
  });
});
