import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  computerRows: [
    {
      id: "computer-1",
      tenant_id: "tenant-1",
      owner_user_id: "user-1",
      migrated_from_agent_id: "agent-1",
    },
  ],
  selectQueue: [] as Array<unknown[]>,
  insertRows: [{ id: "delegation-1", agent_id: "agent-1" }] as Array<
    Record<string, unknown>
  >,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  resolveConnectionForUser: vi.fn(),
  resolveOAuthToken: vi.fn(),
  resolveOAuthTokenDetails: vi.fn(),
  invokeChatAgent: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () =>
              mocks.selectQueue.length > 0
                ? mocks.selectQueue.shift()
                : mocks.computerRows,
          }),
          limit: async () =>
            mocks.selectQueue.length > 0
              ? mocks.selectQueue.shift()
              : mocks.computerRows,
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        mocks.inserts.push(value);
        return {
          returning: async () => mocks.insertRows,
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updates.push(value);
        return {
          where: async () => [],
        };
      },
    }),
  }),
}));

vi.mock("../oauth-token.js", () => ({
  resolveConnectionForUser: mocks.resolveConnectionForUser,
  resolveOAuthToken: mocks.resolveOAuthToken,
  resolveOAuthTokenDetails: mocks.resolveOAuthTokenDetails,
}));

vi.mock("../../graphql/utils.js", () => ({
  invokeChatAgent: mocks.invokeChatAgent,
}));

import {
  checkGoogleWorkspaceConnection,
  delegateConnectorWorkTask,
  resolveGoogleWorkspaceCliToken,
} from "./runtime-api.js";

describe("Computer runtime API Google Workspace status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.computerRows = [
      {
        id: "computer-1",
        tenant_id: "tenant-1",
        owner_user_id: "user-1",
        migrated_from_agent_id: "agent-1",
      },
    ];
    mocks.selectQueue = [];
    mocks.insertRows = [{ id: "delegation-1", agent_id: "agent-1" }];
    mocks.inserts = [];
    mocks.updates = [];
    mocks.invokeChatAgent.mockResolvedValue(true);
  });

  it("reports no active Google Workspace connection for the Computer owner", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue(null);

    const result = await checkGoogleWorkspaceConnection({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(mocks.resolveConnectionForUser).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
      "google_productivity",
    );
    expect(result).toMatchObject({
      providerName: "google_productivity",
      connected: false,
      tokenResolved: false,
      reason: "no_active_connection",
    });
  });

  it("resolves a token without returning token material", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    mocks.resolveOAuthTokenDetails.mockResolvedValue({
      accessToken: "ya29.secret-token",
      grantedScopes: ["https://www.googleapis.com/auth/calendar"],
    });

    const result = await checkGoogleWorkspaceConnection({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(mocks.resolveOAuthTokenDetails).toHaveBeenCalledWith(
      "connection-1",
      "tenant-1",
      "provider-1",
    );
    expect(result).toMatchObject({
      providerName: "google_productivity",
      connected: true,
      tokenResolved: true,
      connectionId: "connection-1",
      calendarScopeGranted: true,
      missingScopes: [],
      reason: null,
    });
    expect(JSON.stringify(result)).not.toContain("ya29");
  });

  it("reports missing Google Calendar scope without returning token material", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    mocks.resolveOAuthTokenDetails.mockResolvedValue({
      accessToken: "ya29.secret-token",
      grantedScopes: ["openid", "email"],
    });

    const result = await checkGoogleWorkspaceConnection({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      connected: true,
      tokenResolved: true,
      calendarScopeGranted: false,
      missingScopes: ["https://www.googleapis.com/auth/calendar"],
    });
    expect(JSON.stringify(result)).not.toContain("ya29");
  });

  it("resolves a Google Workspace CLI token for service-auth runtime use", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    mocks.resolveOAuthTokenDetails.mockResolvedValue({
      accessToken: "ya29.secret-token",
      grantedScopes: ["openid"],
    });

    const result = await resolveGoogleWorkspaceCliToken({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      connected: true,
      tokenResolved: true,
      accessToken: "ya29.secret-token",
      connectionId: "connection-1",
      missingScopes: ["https://www.googleapis.com/auth/calendar"],
    });
  });

  it("returns safe CLI token status when no connection or token is available", async () => {
    mocks.resolveConnectionForUser.mockResolvedValueOnce(null);

    await expect(
      resolveGoogleWorkspaceCliToken({
        tenantId: "tenant-1",
        computerId: "computer-1",
      }),
    ).resolves.toMatchObject({
      connected: false,
      tokenResolved: false,
      reason: "no_active_connection",
    });

    mocks.resolveConnectionForUser.mockResolvedValueOnce({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    mocks.resolveOAuthTokenDetails.mockResolvedValueOnce(null);

    const result = await resolveGoogleWorkspaceCliToken({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(result).toMatchObject({
      connected: true,
      tokenResolved: false,
      reason: "token_unavailable_or_expired",
    });
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });
});

describe("Computer runtime API connector work delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectQueue = [];
    mocks.insertRows = [{ id: "delegation-1", agent_id: "agent-1" }];
    mocks.inserts = [];
    mocks.updates = [];
    mocks.invokeChatAgent.mockResolvedValue(true);
  });

  it("creates a delegation and invokes the managed agent for connector work", async () => {
    mocks.selectQueue = [
      [
        {
          id: "task-1",
          task_type: "connector_work",
          input: {
            connectorId: "connector-1",
            connectorExecutionId: "execution-1",
            externalRef: "TECH-60",
            title: "Handle Linear issue",
            body: "Linear body",
            metadata: { linear: { identifier: "TECH-60" } },
          },
        },
      ],
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          owner_user_id: "user-1",
          migrated_from_agent_id: "agent-1",
        },
      ],
      [{ id: "agent-1" }],
      [],
      [{ id: "thread-1" }],
      [{ id: "message-1" }],
    ];

    const result = await delegateConnectorWorkTask({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
    });

    expect(result).toMatchObject({
      delegated: true,
      idempotent: false,
      mode: "managed_agent",
      delegationId: "delegation-1",
      agentId: "agent-1",
      threadId: "thread-1",
      messageId: "message-1",
      status: "running",
    });
    expect(mocks.invokeChatAgent).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "Linear body",
      messageId: "message-1",
    });
    expect(mocks.inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: "tenant-1",
          computer_id: "computer-1",
          agent_id: "agent-1",
          task_id: "task-1",
          status: "pending",
        }),
        expect.objectContaining({
          event_type: "connector_work_delegation_started",
          task_id: "task-1",
        }),
      ]),
    );
    expect(mocks.updates).toContainEqual({ status: "running" });
  });

  it("returns an existing delegation without invoking a duplicate managed-agent run", async () => {
    mocks.selectQueue = [
      [
        {
          id: "task-1",
          task_type: "connector_work",
          input: {
            connectorId: "connector-1",
            connectorExecutionId: "execution-1",
            externalRef: "TECH-60",
            title: "Handle Linear issue",
            body: "Linear body",
          },
        },
      ],
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          owner_user_id: "user-1",
          migrated_from_agent_id: "agent-1",
        },
      ],
      [{ id: "agent-1" }],
      [
        {
          id: "delegation-existing",
          agent_id: "agent-1",
          status: "running",
          input_artifacts: { threadId: "thread-1" },
        },
      ],
    ];

    const result = await delegateConnectorWorkTask({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
    });

    expect(result).toMatchObject({
      delegated: false,
      idempotent: true,
      delegationId: "delegation-existing",
      agentId: "agent-1",
      threadId: "thread-1",
      status: "running",
    });
    expect(mocks.invokeChatAgent).not.toHaveBeenCalled();
    expect(mocks.inserts).toEqual([]);
  });

  it("rejects connector work when the Computer has no delegated managed agent", async () => {
    mocks.selectQueue = [
      [
        {
          id: "task-1",
          task_type: "connector_work",
          input: {
            connectorId: "connector-1",
            connectorExecutionId: "execution-1",
            externalRef: "TECH-60",
            title: "Handle Linear issue",
            body: "Linear body",
          },
        },
      ],
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          owner_user_id: "user-1",
          migrated_from_agent_id: null,
        },
      ],
    ];

    await expect(
      delegateConnectorWorkTask({
        tenantId: "tenant-1",
        computerId: "computer-1",
        taskId: "task-1",
      }),
    ).rejects.toThrow("Computer has no delegated Managed Agent configured");
    expect(mocks.invokeChatAgent).not.toHaveBeenCalled();
  });
});
