import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLinearTrackerCandidates,
  createDrizzleConnectorRuntimeStore,
  defaultNextPollAt,
  isRuntimeEligibleConnector,
  runConnectorDispatchTick,
  type ConnectorExecutionRow,
  type ConnectorRuntimeCredential,
  type ConnectorRuntimeRow,
  type ConnectorRuntimeStore,
} from "./runtime.js";

const NOW = new Date("2026-05-06T16:00:00.000Z");

describe("connector runtime skeleton", () => {
  it("recognizes only active enabled due connectors", () => {
    expect(isRuntimeEligibleConnector(connector(), NOW)).toBe(true);
    expect(
      isRuntimeEligibleConnector(connector({ status: "paused" }), NOW),
    ).toBe(false);
    expect(isRuntimeEligibleConnector(connector({ enabled: false }), NOW)).toBe(
      false,
    );
    expect(
      isRuntimeEligibleConnector(
        connector({ next_poll_at: new Date("2026-05-06T17:00:00.000Z") }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isRuntimeEligibleConnector(connector(), NOW, { tenantId: "tenant-b" }),
    ).toBe(false);
  });

  it("normalizes Linear-style seed issues into dispatch candidates", () => {
    const [candidate] = buildLinearTrackerCandidates(
      connector({
        config: {
          provider: "linear",
          sourceKind: "tracker_issue",
          seedIssues: [
            {
              id: "issue-1",
              identifier: "SYM-1",
              title: "Wire connector runtime",
              description: "Prove the handoff.",
              url: "https://linear.app/thinkwork/issue/SYM-1",
              labels: ["symphony"],
              state: "Todo",
              priority: 1,
            },
          ],
        },
      }),
    );

    expect(candidate).toMatchObject({
      connectorId: "connector-1",
      tenantId: "tenant-a",
      externalRef: "issue-1",
      title: "Wire connector runtime",
      metadata: {
        sourceKind: "tracker_issue",
        connectorId: "connector-1",
        connectorType: "linear_tracker",
        externalRef: "issue-1",
        linear: {
          identifier: "SYM-1",
          labels: ["symphony"],
          state: "Todo",
        },
      },
    });
    expect(candidate?.body).toContain("Linear issue SYM-1");
    expect(candidate?.body).toContain(
      "Issue URL: https://linear.app/thinkwork/issue/SYM-1",
    );
  });

  it("skips malformed and unknown connector configs without throwing", () => {
    expect(
      buildLinearTrackerCandidates(
        connector({
          config: {
            provider: "linear",
            sourceKind: "tracker_issue",
            seedIssues: [{ title: "Missing id" }],
          },
        }),
      ),
    ).toEqual([]);

    expect(
      buildLinearTrackerCandidates(
        connector({
          type: "slack_channel",
          config: { seedIssues: [{ id: "issue-1", title: "Ignored" }] },
        }),
      ),
    ).toEqual([]);
  });
});

describe("runConnectorDispatchTick", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
  });

  it("claims, dispatches, and finishes a new agent-targeted Linear seed issue", async () => {
    store.connectors = [
      connector({
        config: {
          provider: "linear",
          sourceKind: "tracker_issue",
          seedIssues: [{ id: "issue-1", title: "Handle task" }],
        },
      }),
    ];
    store.claimResult = {
      status: "created",
      execution: execution({ id: "execution-1" }),
    };

    const result = await runConnectorDispatchTick({ now: NOW }, { store });

    expect(result).toEqual([
      {
        status: "dispatched",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "issue-1",
        threadId: "thread-1",
        messageId: "message-1",
      },
    ]);
    expect(store.claims).toHaveLength(1);
    expect(store.createdThreads).toMatchObject([
      {
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "issue-1",
      },
    ]);
    expect(store.terminalUpdates).toMatchObject([
      {
        executionId: "execution-1",
        now: NOW,
        outcomePayload: {
          threadId: "thread-1",
          messageId: "message-1",
          dispatchTargetType: "agent",
          dispatchTargetId: "agent-1",
        },
      },
    ]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("claims, hands off, and finishes a new Computer-targeted Linear seed issue", async () => {
    store.connectors = [
      connector({
        dispatch_target_type: "computer",
        dispatch_target_id: "computer-1",
        config: {
          provider: "linear",
          sourceKind: "tracker_issue",
          seedIssues: [
            {
              id: "issue-1",
              identifier: "TECH-101",
              title: "Handle connector work",
              description: "Prove Computer handoff.",
            },
          ],
        },
      }),
    ];
    store.claimResult = {
      status: "created",
      execution: execution({ id: "execution-1" }),
    };

    const result = await runConnectorDispatchTick({ now: NOW }, { store });

    expect(result).toEqual([
      {
        status: "dispatched",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "issue-1",
        threadId: "thread-1",
        messageId: "message-1",
        computerId: "computer-1",
        computerTaskId: "computer-task-1",
      },
    ]);
    expect(store.createdComputerHandoffs).toMatchObject([
      {
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "issue-1",
        computerId: "computer-1",
      },
    ]);
    expect(store.createdThreads).toEqual([]);
    expect(store.terminalUpdates).toMatchObject([
      {
        executionId: "execution-1",
        now: NOW,
        outcomePayload: {
          threadId: "thread-1",
          messageId: "message-1",
          computerId: "computer-1",
          computerTaskId: "computer-task-1",
          dispatchTargetType: "computer",
          dispatchTargetId: "computer-1",
        },
      },
    ]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("does not create duplicate work for duplicate active external refs", async () => {
    store.connectors = [
      connector({
        dispatch_target_type: "computer",
        dispatch_target_id: "computer-1",
        config: {
          seedIssues: [{ id: "issue-1", title: "Already running" }],
        },
      }),
    ];
    store.claimResult = {
      status: "duplicate",
      execution: execution({ id: "execution-existing" }),
    };

    const result = await runConnectorDispatchTick({ now: NOW }, { store });

    expect(result).toEqual([
      {
        status: "duplicate",
        connectorId: "connector-1",
        executionId: "execution-existing",
        externalRef: "issue-1",
      },
    ]);
    expect(store.createdThreads).toEqual([]);
    expect(store.createdComputerHandoffs).toEqual([]);
    expect(store.terminalUpdates).toEqual([]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("claims but does not dispatch routine targets until the chassis exists", async () => {
    store.connectors = [
      connector({
        dispatch_target_type: "routine",
        dispatch_target_id: "routine-1",
        config: { seedIssues: [{ id: "issue-1", title: "Run workflow" }] },
      }),
    ];
    store.claimResult = {
      status: "created",
      execution: execution({ id: "execution-1" }),
    };

    const result = await runConnectorDispatchTick({ now: NOW }, { store });

    expect(result).toEqual([
      {
        status: "unsupported_target",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "issue-1",
        targetType: "routine",
      },
    ]);
    expect(store.createdThreads).toEqual([]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("marks a claimed execution failed when Computer handoff fails", async () => {
    store.connectors = [
      connector({
        dispatch_target_type: "computer",
        dispatch_target_id: "missing-computer",
        config: { seedIssues: [{ id: "issue-1", title: "No Computer" }] },
      }),
    ];
    store.claimResult = {
      status: "created",
      execution: execution({ id: "execution-1" }),
    };
    store.createComputerHandoffError = new Error("Computer not found");

    const result = await runConnectorDispatchTick({ now: NOW }, { store });

    expect(result).toEqual([
      {
        status: "failed",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "issue-1",
        error: "Computer not found",
      },
    ]);
    expect(store.failedUpdates).toEqual([
      {
        executionId: "execution-1",
        now: NOW,
        error: "Computer not found",
      },
    ]);
    expect(store.terminalUpdates).toEqual([]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("marks a claimed execution failed when agent dispatch fails", async () => {
    store.connectors = [
      connector({
        config: { seedIssues: [{ id: "issue-1", title: "Explode" }] },
      }),
    ];
    store.claimResult = {
      status: "created",
      execution: execution({ id: "execution-1" }),
    };
    store.createAgentThreadError = new Error(
      "chat-agent-invoke dispatch failed",
    );

    const result = await runConnectorDispatchTick({ now: NOW }, { store });

    expect(result).toEqual([
      {
        status: "failed",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "issue-1",
        error: "chat-agent-invoke dispatch failed",
      },
    ]);
    expect(store.failedUpdates).toEqual([
      {
        executionId: "execution-1",
        now: NOW,
        error: "chat-agent-invoke dispatch failed",
      },
    ]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("reports skipped connectors with no deterministic candidates", async () => {
    store.connectors = [connector({ config: { provider: "linear" } })];

    const result = await runConnectorDispatchTick({ now: NOW }, { store });

    expect(result).toEqual([
      {
        status: "skipped",
        connectorId: "connector-1",
        reason: "no_dispatch_candidates",
      },
    ]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("does not advance poll metadata for a future-due connector skipped by a scheduled tick", async () => {
    store.connectors = [
      connector({ next_poll_at: new Date("2026-05-06T17:00:00.000Z") }),
    ];

    const result = await runConnectorDispatchTick({ now: NOW }, { store });

    expect(result).toEqual([
      {
        status: "skipped",
        connectorId: "connector-1",
        reason: "connector_not_active_enabled_due",
      },
    ]);
    expect(store.claims).toEqual([]);
    expect(store.polledConnectors).toEqual([]);
  });

  it("force-runs a future-due connector and advances poll metadata from the forced clock", async () => {
    store.connectors = [
      connector({
        next_poll_at: new Date("2026-05-06T17:00:00.000Z"),
        config: { seedIssues: [{ id: "issue-1", title: "Force me" }] },
      }),
    ];
    store.claimResult = {
      status: "created",
      execution: execution({ id: "execution-1" }),
    };

    const result = await runConnectorDispatchTick(
      { now: NOW, force: true },
      { store },
    );

    expect(result).toMatchObject([
      {
        status: "dispatched",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "issue-1",
      },
    ]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("fetches real Linear issues through the tenant credential vault", async () => {
    store.connectors = [
      connector({
        config: {
          provider: "linear",
          sourceKind: "tracker_issue",
          credentialSlug: "linear",
          issueQuery: {
            labels: ["symphony"],
            limit: 1,
          },
        },
      }),
    ];
    store.credential = {
      id: "credential-1",
      tenant_id: "tenant-a",
      slug: "linear",
      kind: "api_key",
      status: "active",
      secret_ref: "secret-ref",
    };
    store.claimResult = {
      status: "created",
      execution: execution({ id: "execution-1" }),
    };
    const readTenantCredentialSecret = vi.fn().mockResolvedValue({
      apiKey: "lin_api_key",
    });
    const fetchLinearIssues = vi.fn().mockResolvedValue([
      {
        id: "linear-issue-1",
        identifier: "SYM-101",
        title: "Handle real Linear issue",
        description: "From Linear API",
        url: "https://linear.app/thinkwork/issue/SYM-101",
        labels: ["symphony"],
        state: "Todo",
        priority: 2,
      },
    ]);

    const result = await runConnectorDispatchTick(
      { now: NOW },
      { store, readTenantCredentialSecret, fetchLinearIssues },
    );

    expect(store.credentialLookups).toEqual([
      {
        tenantId: "tenant-a",
        credentialId: undefined,
        credentialSlug: "linear",
      },
    ]);
    expect(readTenantCredentialSecret).toHaveBeenCalledWith("secret-ref");
    expect(fetchLinearIssues).toHaveBeenCalledWith({
      apiKey: "lin_api_key",
      query: expect.objectContaining({
        credentialSlug: "linear",
        labels: ["symphony"],
        limit: 1,
      }),
    });
    expect(result).toEqual([
      {
        status: "dispatched",
        connectorId: "connector-1",
        executionId: "execution-1",
        externalRef: "linear-issue-1",
        threadId: "thread-1",
        messageId: "message-1",
      },
    ]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });

  it("reports a failed connector when Linear credential lookup fails", async () => {
    store.connectors = [
      connector({
        config: {
          provider: "linear",
          sourceKind: "tracker_issue",
          credentialSlug: "missing",
          issueQuery: { labels: ["symphony"] },
        },
      }),
    ];

    const result = await runConnectorDispatchTick(
      { now: NOW },
      {
        store,
        readTenantCredentialSecret: vi.fn(),
        fetchLinearIssues: vi.fn(),
      },
    );

    expect(result).toEqual([
      {
        status: "failed",
        connectorId: "connector-1",
        error: "Linear credential not found",
      },
    ]);
    expect(store.claims).toEqual([]);
    expect(store.polledConnectors).toEqual([
      {
        connectorId: "connector-1",
        now: NOW,
        nextPollAt: defaultNextPollAt(NOW),
      },
    ]);
  });
});

describe("createDrizzleConnectorRuntimeStore", () => {
  it("treats any existing connector external ref as duplicate, including terminal executions", async () => {
    const existing = execution({
      id: "execution-terminal",
      current_state: "terminal",
    });
    const limit = vi.fn().mockResolvedValue([existing]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const insert = vi.fn();
    const db = { select, insert } as unknown as Parameters<
      typeof createDrizzleConnectorRuntimeStore
    >[0];
    const store = createDrizzleConnectorRuntimeStore(db, vi.fn());

    const result = await store.claimExecution({
      connector: connector(),
      candidate: {
        connectorId: "connector-1",
        tenantId: "tenant-a",
        externalRef: "issue-1",
        title: "Already handled",
        body: "Already handled",
        metadata: {},
      },
      now: NOW,
    });

    expect(result).toEqual({ status: "duplicate", execution: existing });
    expect(insert).not.toHaveBeenCalled();
  });
});

class FakeStore implements ConnectorRuntimeStore {
  connectors: ConnectorRuntimeRow[] = [];
  claimResult:
    | { status: "created"; execution: ConnectorExecutionRow }
    | { status: "duplicate"; execution?: ConnectorExecutionRow } = {
    status: "created",
    execution: execution(),
  };
  createAgentThreadError: Error | null = null;
  createComputerHandoffError: Error | null = null;
  credential: ConnectorRuntimeCredential | null = null;
  claims: Array<{ connectorId: string; externalRef: string }> = [];
  credentialLookups: Array<{
    tenantId: string;
    credentialId?: string;
    credentialSlug?: string;
  }> = [];
  createdThreads: Array<{
    connectorId: string;
    executionId: string;
    externalRef: string;
  }> = [];
  createdComputerHandoffs: Array<{
    connectorId: string;
    executionId: string;
    externalRef: string;
    computerId: string;
  }> = [];
  terminalUpdates: Array<{
    executionId: string;
    now: Date;
    outcomePayload: Record<string, unknown>;
  }> = [];
  failedUpdates: Array<{
    executionId: string;
    now: Date;
    error: string;
  }> = [];
  polledConnectors: Array<{
    connectorId: string;
    now: Date;
    nextPollAt: Date;
  }> = [];

  async listDueConnectors() {
    return this.connectors;
  }

  async claimExecution(
    args: Parameters<ConnectorRuntimeStore["claimExecution"]>[0],
  ) {
    this.claims.push({
      connectorId: args.connector.id,
      externalRef: args.candidate.externalRef,
    });
    return this.claimResult;
  }

  async createAgentThread(
    args: Parameters<ConnectorRuntimeStore["createAgentThread"]>[0],
  ) {
    if (this.createAgentThreadError) throw this.createAgentThreadError;
    this.createdThreads.push({
      connectorId: args.connector.id,
      executionId: args.execution.id,
      externalRef: args.candidate.externalRef,
    });
    return { threadId: "thread-1", messageId: "message-1" };
  }

  async createComputerHandoff(
    args: Parameters<ConnectorRuntimeStore["createComputerHandoff"]>[0],
  ) {
    if (this.createComputerHandoffError) throw this.createComputerHandoffError;
    this.createdComputerHandoffs.push({
      connectorId: args.connector.id,
      executionId: args.execution.id,
      externalRef: args.candidate.externalRef,
      computerId: args.connector.dispatch_target_id,
    });
    return {
      computerId: args.connector.dispatch_target_id,
      computerTaskId: "computer-task-1",
      threadId: "thread-1",
      messageId: "message-1",
    };
  }

  async markExecutionTerminal(
    args: Parameters<ConnectorRuntimeStore["markExecutionTerminal"]>[0],
  ) {
    this.terminalUpdates.push({
      executionId: args.executionId,
      now: args.now,
      outcomePayload: args.outcomePayload,
    });
  }

  async markExecutionFailed(
    args: Parameters<ConnectorRuntimeStore["markExecutionFailed"]>[0],
  ) {
    this.failedUpdates.push(args);
  }

  async markConnectorPolled(
    args: Parameters<ConnectorRuntimeStore["markConnectorPolled"]>[0],
  ) {
    this.polledConnectors.push(args);
  }

  async loadTenantCredential(
    args: Parameters<ConnectorRuntimeStore["loadTenantCredential"]>[0],
  ) {
    this.credentialLookups.push(args);
    return this.credential;
  }
}

function connector(
  overrides: Partial<ConnectorRuntimeRow> = {},
): ConnectorRuntimeRow {
  return {
    id: "connector-1",
    tenant_id: "tenant-a",
    type: "linear_tracker",
    name: "Symphony",
    description: null,
    status: "active",
    connection_id: null,
    config: {},
    dispatch_target_type: "agent",
    dispatch_target_id: "agent-1",
    last_poll_at: null,
    last_poll_cursor: null,
    next_poll_at: null,
    eb_schedule_name: null,
    enabled: true,
    created_by_type: "admin",
    created_by_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function execution(
  overrides: Partial<ConnectorExecutionRow> = {},
): ConnectorExecutionRow {
  return {
    id: "execution-1",
    tenant_id: "tenant-a",
    connector_id: "connector-1",
    external_ref: "issue-1",
    current_state: "pending",
    spend_envelope_usd_cents: null,
    state_machine_arn: null,
    started_at: null,
    finished_at: null,
    error_class: null,
    outcome_payload: null,
    cost_finalized_at: null,
    last_usage_event_at: null,
    kill_target: null,
    kill_target_at: null,
    retry_attempt: 0,
    created_at: NOW,
    ...overrides,
  };
}
