import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockInnerJoin = vi.fn();
const mockLeftJoin = vi.fn();
const mockResolveCallerTenantId = vi.fn();

const queryBuilder = {
  innerJoin: mockInnerJoin,
  leftJoin: mockLeftJoin,
  limit: mockLimit,
  orderBy: mockOrderBy,
  where: mockWhere,
};

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: mockFrom,
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
  computerDelegations: {
    id: "computer_delegations.id",
    tenant_id: "computer_delegations.tenant_id",
    task_id: "computer_delegations.task_id",
    agent_id: "computer_delegations.agent_id",
    status: "computer_delegations.status",
    input_artifacts: "computer_delegations.input_artifacts",
    output_artifacts: "computer_delegations.output_artifacts",
    result: "computer_delegations.result",
    error: "computer_delegations.error",
    completed_at: "computer_delegations.completed_at",
    created_at: "computer_delegations.created_at",
  },
  computerTasks: {
    id: "computer_tasks.id",
    tenant_id: "computer_tasks.tenant_id",
    status: "computer_tasks.status",
    input: "computer_tasks.input",
    output: "computer_tasks.output",
    error: "computer_tasks.error",
    completed_at: "computer_tasks.completed_at",
    created_at: "computer_tasks.created_at",
  },
  connectorExecutions: {
    id: "connector_executions.id",
    tenant_id: "connector_executions.tenant_id",
    connector_id: "connector_executions.connector_id",
    current_state: "connector_executions.current_state",
    started_at: "connector_executions.started_at",
    created_at: "connector_executions.created_at",
    outcome_payload: "connector_executions.outcome_payload",
  },
  connectors: {
    id: "connectors.id",
    tenant_id: "connectors.tenant_id",
    status: "connectors.status",
    type: "connectors.type",
    created_at: "connectors.created_at",
  },
  threadTurns: {
    id: "thread_turns.id",
    tenant_id: "thread_turns.tenant_id",
    thread_id: "thread_turns.thread_id",
    agent_id: "thread_turns.agent_id",
    status: "thread_turns.status",
    result_json: "thread_turns.result_json",
    error: "thread_turns.error",
    error_code: "thread_turns.error_code",
    started_at: "thread_turns.started_at",
    finished_at: "thread_turns.finished_at",
    created_at: "thread_turns.created_at",
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: [Array.from(strings), values],
  }),
}));

let resolvers: typeof import("./query.js");

beforeEach(async () => {
  mockRows.mockReset();
  mockFrom.mockReset();
  mockWhere.mockReset();
  mockOrderBy.mockReset();
  mockLimit.mockReset();
  mockInnerJoin.mockReset();
  mockLeftJoin.mockReset();
  mockResolveCallerTenantId.mockReset();
  vi.resetModules();

  mockResolveCallerTenantId.mockResolvedValue(null);
  mockLimit.mockImplementation(() => Promise.resolve(mockRows()));
  mockFrom.mockReturnValue(queryBuilder);
  mockInnerJoin.mockReturnValue(queryBuilder);
  mockLeftJoin.mockReturnValue(queryBuilder);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue(queryBuilder);

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

  it("lists connector run lifecycle rows with task, delegation, and turn metadata", async () => {
    mockRows.mockReturnValueOnce([{ id: "connector-a" }]).mockReturnValueOnce([
      {
        execution: {
          id: "execution-1",
          tenant_id: "tenant-a",
          connector_id: "connector-a",
          external_ref: "linear-issue-1",
          current_state: "terminal",
          outcome_payload: {
            threadId: "thread-1",
            messageId: "message-1",
            computerId: "computer-1",
            computerTaskId: "task-1",
          },
        },
        connector: {
          id: "connector-a",
          tenant_id: "tenant-a",
          type: "linear_tracker",
          name: "Linear Symphony",
          status: "active",
        },
        taskId: "task-1",
        taskStatus: "completed",
        taskInput: { externalRef: "linear-issue-1" },
        taskOutput: { mode: "managed_agent" },
        taskError: null,
        taskCompletedAt: "2026-05-07T18:15:19.000Z",
        taskCreatedAt: "2026-05-07T18:15:16.000Z",
        delegationId: "delegation-1",
        delegationStatus: "completed",
        delegationAgentId: "agent-1",
        delegationInputArtifacts: { threadId: "thread-1" },
        delegationOutputArtifacts: { threadTurnId: "turn-1" },
        delegationResult: { status: "succeeded" },
        delegationError: null,
        delegationCompletedAt: "2026-05-07T18:16:01.000Z",
        delegationCreatedAt: "2026-05-07T18:15:17.000Z",
        turnId: "turn-1",
        turnThreadId: "thread-1",
        turnAgentId: "agent-1",
        turnStatus: "succeeded",
        turnResultJson: { responsePreview: "done" },
        turnError: null,
        turnErrorCode: null,
        turnStartedAt: "2026-05-07T18:15:23.000Z",
        turnFinishedAt: "2026-05-07T18:16:01.000Z",
        turnCreatedAt: "2026-05-07T18:15:23.000Z",
      },
    ]);

    const result = await resolvers.connectorRunLifecycles(
      null,
      { connectorId: "connector-a", limit: 10 },
      { auth: { tenantId: "tenant-a" } } as any,
    );

    expect(result).toEqual([
      {
        execution: {
          id: "execution-1",
          tenantId: "tenant-a",
          connectorId: "connector-a",
          externalRef: "linear-issue-1",
          currentState: "terminal",
          outcomePayload: {
            threadId: "thread-1",
            messageId: "message-1",
            computerId: "computer-1",
            computerTaskId: "task-1",
          },
        },
        connector: {
          id: "connector-a",
          tenantId: "tenant-a",
          type: "linear_tracker",
          name: "Linear Symphony",
          status: "active",
        },
        computerTask: {
          id: "task-1",
          status: "completed",
          input: { externalRef: "linear-issue-1" },
          output: { mode: "managed_agent" },
          error: null,
          completedAt: "2026-05-07T18:15:19.000Z",
          createdAt: "2026-05-07T18:15:16.000Z",
        },
        delegation: {
          id: "delegation-1",
          status: "completed",
          agentId: "agent-1",
          inputArtifacts: { threadId: "thread-1" },
          outputArtifacts: { threadTurnId: "turn-1" },
          result: { status: "succeeded" },
          error: null,
          completedAt: "2026-05-07T18:16:01.000Z",
          createdAt: "2026-05-07T18:15:17.000Z",
        },
        threadTurn: {
          id: "turn-1",
          threadId: "thread-1",
          agentId: "agent-1",
          status: "succeeded",
          resultJson: { responsePreview: "done" },
          error: null,
          errorCode: null,
          startedAt: "2026-05-07T18:15:23.000Z",
          finishedAt: "2026-05-07T18:16:01.000Z",
          createdAt: "2026-05-07T18:15:23.000Z",
        },
        threadId: "thread-1",
        messageId: "message-1",
        computerId: "computer-1",
      },
    ]);
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
    expect(mockLeftJoin).toHaveBeenCalledTimes(3);
    expect(mockWhere).toHaveBeenLastCalledWith({
      and: [
        { eq: ["connector_executions.tenant_id", "tenant-a"] },
        { eq: ["connector_executions.connector_id", "connector-a"] },
      ],
    });
    expect(mockLimit).toHaveBeenLastCalledWith(10);
  });

  it("returns partial lifecycle rows when downstream artifacts are not present yet", async () => {
    mockRows.mockReturnValueOnce([
      {
        execution: {
          id: "execution-1",
          tenant_id: "tenant-a",
          connector_id: "connector-a",
          external_ref: "linear-issue-1",
          current_state: "dispatching",
          outcome_payload: null,
        },
        connector: {
          id: "connector-a",
          tenant_id: "tenant-a",
          type: "linear_tracker",
          name: "Linear Symphony",
          status: "active",
        },
        taskId: null,
        delegationId: null,
        turnId: null,
      },
    ]);

    const result = await resolvers.connectorRunLifecycles(
      null,
      { limit: 200 },
      {
        auth: { tenantId: "tenant-a" },
      } as any,
    );

    expect(result).toEqual([
      expect.objectContaining({
        computerTask: null,
        delegation: null,
        threadTurn: null,
        threadId: null,
        messageId: null,
        computerId: null,
      }),
    ]);
    expect(mockLimit).toHaveBeenLastCalledWith(100);
  });

  it("returns an empty lifecycle list for a cross-tenant connector", async () => {
    mockRows.mockReturnValueOnce([]);

    await expect(
      resolvers.connectorRunLifecycles(null, { connectorId: "connector-b" }, {
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
