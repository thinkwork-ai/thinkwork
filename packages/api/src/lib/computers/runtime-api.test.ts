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
  notifyNewMessage: vi.fn(),
  notifyThreadUpdate: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => {
      const rows = () =>
        Promise.resolve(
          mocks.selectQueue.length > 0
            ? mocks.selectQueue.shift()
            : mocks.computerRows,
        );
      const result = () => {
        const chain = {
          orderBy: () => chain,
          limit: rows,
          then: (
            resolve: (value: unknown[] | undefined) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => rows().then(resolve, reject),
        };
        return chain;
      };
      return { from: () => ({ where: result }) };
    },
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

vi.mock("../../graphql/notify.js", () => ({
  notifyNewMessage: mocks.notifyNewMessage,
  notifyThreadUpdate: mocks.notifyThreadUpdate,
}));

import {
  checkGoogleWorkspaceConnection,
  delegateConnectorWorkTask,
  executeThreadTurnTask,
  loadThreadTurnContext,
  recordThreadTurnResponse,
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
    mocks.notifyNewMessage.mockResolvedValue(undefined);
    mocks.notifyThreadUpdate.mockResolvedValue(undefined);
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

describe("Computer runtime API thread turn execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectQueue = [];
    mocks.insertRows = [{ id: "event-1" }];
    mocks.inserts = [];
    mocks.updates = [];
    mocks.invokeChatAgent.mockResolvedValue(true);
  });

  it("loads Computer-owned Thread turn context for the native runtime", async () => {
    mocks.selectQueue = [
      [
        {
          id: "task-1",
          task_type: "thread_turn",
          input: {
            threadId: "thread-1",
            messageId: "message-1",
            source: "chat_message",
          },
        },
      ],
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          owner_user_id: "user-1",
          name: "Marco",
          slug: "marco",
          live_workspace_root: "/workspace",
          runtime_config: { chatModel: "model-1" },
          migrated_from_agent_id: "agent-1",
        },
      ],
      [{ id: "thread-1", title: "Hello", status: "in_progress" }],
      [{ id: "message-1", role: "user", content: "hello computer" }],
      [
        { id: "message-1", role: "user", content: "hello computer" },
        { id: "message-0", role: "assistant", content: "previous reply" },
      ],
    ];

    const result = await loadThreadTurnContext({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
    });

    expect(result).toMatchObject({
      taskId: "task-1",
      source: "chat_message",
      computer: { id: "computer-1", name: "Marco", slug: "marco" },
      thread: { id: "thread-1", title: "Hello" },
      message: { id: "message-1", content: "hello computer" },
      model: "model-1",
    });
    expect(result.messagesHistory).toHaveLength(2);
    expect(mocks.invokeChatAgent).not.toHaveBeenCalled();
  });

  it("records native Computer responses as assistant messages and events", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.selectQueue = [
      [
        {
          id: "task-1",
          task_type: "thread_turn",
          input: {
            threadId: "thread-1",
            messageId: "message-1",
            source: "chat_message",
          },
        },
      ],
      [{ id: "thread-1", title: "Hello", status: "in_progress" }],
      [{ id: "message-1", role: "user", content: "hello computer" }],
      [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          owner_user_id: "user-1",
          migrated_from_agent_id: "agent-1",
        },
      ],
      [
        {
          id: "task-1",
          task_type: "thread_turn",
          input: {
            threadId: "thread-1",
            messageId: "message-1",
            source: "chat_message",
          },
        },
      ],
    ];

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "Native Computer response",
      model: "model-1",
      usage: { inputTokens: 5 },
    });

    expect(result).toMatchObject({
      responded: true,
      mode: "computer_native",
      responseMessageId: "assistant-message-1",
      threadId: "thread-1",
      messageId: "message-1",
      status: "completed",
      model: "model-1",
    });
    expect(mocks.inserts).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: "Native Computer response",
        sender_type: "computer",
        sender_id: "computer-1",
        metadata: expect.objectContaining({
          computerId: "computer-1",
          taskId: "task-1",
          sourceMessageId: "message-1",
        }),
      }),
    );
    expect(mocks.inserts).toContainEqual(
      expect.objectContaining({
        event_type: "thread_turn_response_recorded",
        task_id: "task-1",
      }),
    );
    expect(mocks.notifyNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "assistant-message-1",
        threadId: "thread-1",
        senderType: "computer",
      }),
    );
  });

  it("rejects legacy managed-agent Thread turn execution", async () => {
    mocks.selectQueue = [
      [
        {
          id: "task-1",
          task_type: "thread_turn",
          input: {
            threadId: "thread-1",
            messageId: "message-1",
          },
        },
      ],
    ];

    await expect(
      executeThreadTurnTask({
        tenantId: "tenant-1",
        computerId: "computer-1",
        taskId: "task-1",
      }),
    ).rejects.toThrow("Legacy Managed Agent thread_turn execution is disabled");
    expect(mocks.invokeChatAgent).not.toHaveBeenCalled();
  });
});
