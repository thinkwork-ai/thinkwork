import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockResolveCallerTenantId = vi.fn();

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockWhere,
      }),
    }),
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
  connectorExecutions: {
    id: "connector_executions.id",
    tenant_id: "connector_executions.tenant_id",
    connector_id: "connector_executions.connector_id",
    current_state: "connector_executions.current_state",
    started_at: "connector_executions.started_at",
  },
  connectors: {
    id: "connectors.id",
    tenant_id: "connectors.tenant_id",
    status: "connectors.status",
    type: "connectors.type",
    created_at: "connectors.created_at",
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  desc: (col: unknown) => ({ desc: col }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  lt: (col: unknown, val: unknown) => ({ lt: [col, val] }),
  ne: (col: unknown, val: unknown) => ({ ne: [col, val] }),
}));

let resolvers: typeof import("./query.js");

beforeEach(async () => {
  mockRows.mockReset();
  mockWhere.mockReset();
  mockOrderBy.mockReset();
  mockLimit.mockReset();
  mockResolveCallerTenantId.mockReset();
  vi.resetModules();

  mockResolveCallerTenantId.mockResolvedValue(null);
  mockLimit.mockImplementation(() => Promise.resolve(mockRows()));
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({
    limit: mockLimit,
    orderBy: mockOrderBy,
  });

  resolvers = await import("./query.js");
});

describe("connector queries", () => {
  it("lists tenant-scoped connectors and excludes archived rows by default", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "connector-1",
        tenant_id: "tenant-a",
        type: "linear_tracker",
        status: "active",
      },
    ]);

    const result = await resolvers.connectors_(
      null,
      { filter: { type: "linear_tracker" }, limit: 10 },
      { auth: { tenantId: "tenant-a" } } as any,
    );

    expect(result).toEqual([
      {
        id: "connector-1",
        tenantId: "tenant-a",
        type: "linear_tracker",
        status: "active",
      },
    ]);
    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["connectors.tenant_id", "tenant-a"] },
        { ne: ["connectors.status", "archived"] },
        { eq: ["connectors.type", "linear_tracker"] },
      ],
    });
    expect(mockOrderBy).toHaveBeenCalledWith({ desc: "connectors.created_at" });
    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it("filters connector list by explicit status including archived", async () => {
    mockRows.mockReturnValueOnce([]);

    await resolvers.connectors_(null, { filter: { status: "archived" } }, {
      auth: { tenantId: "tenant-a" },
    } as any);

    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["connectors.tenant_id", "tenant-a"] },
        { eq: ["connectors.status", "archived"] },
      ],
    });
  });

  it("masks a single connector from another tenant", async () => {
    mockRows.mockReturnValueOnce([]);

    await expect(
      resolvers.connector(null, { id: "connector-b" }, {
        auth: { tenantId: "tenant-a" },
      } as any),
    ).resolves.toBeNull();
    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["connectors.id", "connector-b"] },
        { eq: ["connectors.tenant_id", "tenant-a"] },
      ],
    });
  });

  it("returns connector executions only after the parent connector is tenant-visible", async () => {
    mockRows.mockReturnValueOnce([{ id: "connector-a" }]).mockReturnValueOnce([
      {
        id: "execution-1",
        tenant_id: "tenant-a",
        connector_id: "connector-a",
        current_state: "pending",
        external_ref: "ISSUE-1",
      },
    ]);

    const result = await resolvers.connectorExecutions(
      null,
      { connectorId: "connector-a", status: "pending", limit: 200 },
      { auth: { tenantId: "tenant-a" } } as any,
    );

    expect(result).toEqual([
      {
        id: "execution-1",
        tenantId: "tenant-a",
        connectorId: "connector-a",
        currentState: "pending",
        externalRef: "ISSUE-1",
      },
    ]);
    expect(mockWhere).toHaveBeenLastCalledWith({
      and: [
        { eq: ["connector_executions.tenant_id", "tenant-a"] },
        { eq: ["connector_executions.connector_id", "connector-a"] },
        { eq: ["connector_executions.current_state", "pending"] },
      ],
    });
    expect(mockLimit).toHaveBeenLastCalledWith(100);
  });

  it("lists recent tenant connector executions without a connector filter", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "execution-1",
        tenant_id: "tenant-a",
        connector_id: "connector-a",
        current_state: "terminal",
        external_ref: "ISSUE-1",
      },
    ]);

    const result = await resolvers.connectorExecutions(null, { limit: 10 }, {
      auth: { tenantId: "tenant-a" },
    } as any);

    expect(result).toEqual([
      {
        id: "execution-1",
        tenantId: "tenant-a",
        connectorId: "connector-a",
        currentState: "terminal",
        externalRef: "ISSUE-1",
      },
    ]);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledWith({
      and: [{ eq: ["connector_executions.tenant_id", "tenant-a"] }],
    });
  });

  it("returns an empty execution list for a cross-tenant connector", async () => {
    mockRows.mockReturnValueOnce([]);

    await expect(
      resolvers.connectorExecutions(null, { connectorId: "connector-b" }, {
        auth: { tenantId: "tenant-a" },
      } as any),
    ).resolves.toEqual([]);
    expect(mockWhere).toHaveBeenCalledWith({
      and: [
        { eq: ["connectors.id", "connector-b"] },
        { eq: ["connectors.tenant_id", "tenant-a"] },
      ],
    });
  });

  it("uses the OAuth tenant fallback for a single connector execution", async () => {
    mockRows.mockReturnValueOnce([
      {
        id: "execution-1",
        tenant_id: "tenant-a",
        connector_id: "connector-a",
        current_state: "terminal",
      },
    ]);
    mockResolveCallerTenantId.mockResolvedValue("tenant-a");

    const result = await resolvers.connectorExecution(
      null,
      { id: "execution-1" },
      {
        auth: { authType: "cognito", tenantId: null },
      } as any,
    );

    expect(result).toEqual({
      id: "execution-1",
      tenantId: "tenant-a",
      connectorId: "connector-a",
      currentState: "terminal",
    });
  });

  it("rejects list queries when no tenant can be resolved", async () => {
    await expect(
      resolvers.connectors_(null, {}, { auth: { tenantId: null } } as any),
    ).rejects.toMatchObject({
      extensions: { code: "UNAUTHENTICATED" },
    });
  });
});
