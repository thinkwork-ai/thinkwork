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
  updateRows: [] as Array<Array<Record<string, unknown>>>,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  execute: vi.fn(),
  resolveConnectionForUser: vi.fn(),
  resolveOAuthToken: vi.fn(),
  resolveOAuthTokenDetails: vi.fn(),
  invokeChatAgent: vi.fn(),
  notifyNewMessage: vi.fn(),
  notifyThreadUpdate: vi.fn(),
  ensureMigratedComputerWorkspaceSeeded: vi.fn(),
  ensureDefaultComputerRunbookSkillsMaterialized: vi.fn(),
  assembleRequesterContext: vi.fn(),
  s3Send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: mocks.s3Send })),
  GetObjectCommand: vi.fn((input) => ({ input })),
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
        const rows = () => Promise.resolve(mocks.updateRows.shift() ?? []);
        return {
          where: () => ({
            returning: async () => rows(),
            then: (
              resolve: (value: unknown[] | undefined) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => rows().then(resolve, reject),
          }),
        };
      },
    }),
    execute: mocks.execute,
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

vi.mock("./workspace-seed.js", () => ({
  ensureMigratedComputerWorkspaceSeeded:
    mocks.ensureMigratedComputerWorkspaceSeeded,
  ensureDefaultComputerRunbookSkillsMaterialized:
    mocks.ensureDefaultComputerRunbookSkillsMaterialized,
}));

vi.mock("./requester-context.js", () => ({
  assembleRequesterContext: mocks.assembleRequesterContext,
  formatRequesterContextForPrompt: vi.fn((context) =>
    context ? "Requester context overlay" : "",
  ),
}));

import {
  checkGoogleWorkspaceConnection,
  executeThreadTurnTask,
  loadThreadTurnContext,
  recordComputerHeartbeat,
  recordThreadTurnResponse,
  resolveGoogleWorkspaceCliToken,
  buildDraftAppletSourceDigest,
  draftPreviewPartsFromUsage,
  verifyDraftAppletPromotionProof,
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
    mocks.updateRows = [];
    mocks.inserts = [];
    mocks.updates = [];
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.invokeChatAgent.mockResolvedValue(true);
    mocks.notifyNewMessage.mockResolvedValue(undefined);
    mocks.notifyThreadUpdate.mockResolvedValue(undefined);
    mocks.ensureMigratedComputerWorkspaceSeeded.mockResolvedValue({
      seeded: false,
    });
    mocks.ensureDefaultComputerRunbookSkillsMaterialized.mockResolvedValue({
      seeded: false,
    });
    mocks.assembleRequesterContext.mockImplementation(async (input: any) => ({
      contextClass: input.contextClass ?? "user",
      computerId: input.computerId,
      requester: { userId: input.requesterUserId ?? null },
      sourceSurface: input.sourceSurface ?? "chat_message",
      personalMemory: {
        hits: [],
        status: {
          providerId: "memory",
          displayName: "Hindsight Memory",
          state: "skipped",
          hitCount: 0,
          reason: "no personal memory matched the request",
          metadata: {
            contextClass: input.contextClass ?? "user",
            requesterUserId: input.requesterUserId ?? null,
            computerId: input.computerId,
            sourceSurface: input.sourceSurface ?? "chat_message",
          },
        },
      },
    }));
    mocks.s3Send.mockReset();
    mocks.s3Send.mockResolvedValue({
      Body: Buffer.from("# Report\n\nRevenue grew 12%.\n", "utf8"),
    });
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it("reports no active Google Workspace connection for the requester", async () => {
    mocks.resolveConnectionForUser.mockResolvedValue(null);

    const result = await checkGoogleWorkspaceConnection({
      tenantId: "tenant-1",
      computerId: "computer-1",
      requesterUserId: "requester-1",
    });

    expect(mocks.resolveConnectionForUser).toHaveBeenCalledWith(
      "tenant-1",
      "requester-1",
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
      requesterUserId: "requester-1",
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
      requesterUserId: "requester-1",
    });

    expect(result).toMatchObject({
      connected: true,
      tokenResolved: true,
      calendarScopeGranted: false,
      missingScopes: ["https://www.googleapis.com/auth/calendar"],
    });
    expect(JSON.stringify(result)).not.toContain("ya29");
  });

  it("resolves a Google Workspace CLI token for requester-auth runtime use", async () => {
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
      requesterUserId: "requester-1",
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
        requesterUserId: "requester-1",
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
      requesterUserId: "requester-1",
    });

    expect(result).toMatchObject({
      connected: true,
      tokenResolved: false,
      reason: "token_unavailable_or_expired",
    });
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });

  it("fails Google Workspace credential resolution closed without requester identity", async () => {
    const result = await resolveGoogleWorkspaceCliToken({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });

    expect(mocks.resolveConnectionForUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      connected: false,
      tokenResolved: false,
      reason: "requester_user_required",
    });
  });
});

describe("Computer runtime API heartbeat workspace materialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateRows = [
      [
        {
          id: "computer-1",
          runtime_status: "running",
          live_workspace_root: "/workspace",
          last_heartbeat_at: new Date("2026-05-12T12:00:00.000Z"),
          last_active_at: new Date("2026-05-12T12:00:00.000Z"),
        },
      ],
    ];
    mocks.updates = [];
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.ensureMigratedComputerWorkspaceSeeded.mockResolvedValue({
      seeded: false,
    });
    mocks.ensureDefaultComputerRunbookSkillsMaterialized.mockResolvedValue({
      seeded: true,
      copied: 3,
      enqueued: 3,
      skipped: 0,
    });
  });

  it("materializes default runbook skills after recording heartbeat", async () => {
    const result = await recordComputerHeartbeat({
      tenantId: "tenant-1",
      computerId: "computer-1",
      runtimeStatus: "running",
      runtimeVersion: "runtime-1",
      workspaceRoot: "/workspace",
    });

    expect(result).toMatchObject({
      computerId: "computer-1",
      runtimeStatus: "running",
      liveWorkspaceRoot: "/workspace",
      runtimeVersion: "runtime-1",
    });
    expect(mocks.ensureMigratedComputerWorkspaceSeeded).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });
    expect(
      mocks.ensureDefaultComputerRunbookSkillsMaterialized,
    ).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      computerId: "computer-1",
    });
  });

  it("reconciles stale runbook tasks on heartbeat", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ task_id: "runbook-task-1", run_id: "run-1" }],
      })
      .mockResolvedValue({ rows: [] });

    const result = await recordComputerHeartbeat({
      tenantId: "tenant-1",
      computerId: "computer-1",
      runtimeStatus: "running",
      runtimeVersion: "runtime-1",
      workspaceRoot: "/workspace",
    });

    expect(result).toMatchObject({ staleRunbookTasksReconciled: 1 });
    expect(mocks.execute).toHaveBeenCalledTimes(5);
  });

  it("marks the thread blocked and posts a message when a stale runbook task times out", async () => {
    mocks.updateRows = [
      [
        {
          id: "computer-1",
          runtime_status: "running",
          live_workspace_root: "/workspace",
          last_heartbeat_at: new Date("2026-05-12T12:00:00.000Z"),
          last_active_at: new Date("2026-05-12T12:00:00.000Z"),
        },
      ],
      [{ status: "blocked", title: "CRM dashboard" }],
    ];
    mocks.insertRows = [{ id: "message-1" }];
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            task_id: "runbook-task-1",
            task_title: "Generate and save artifact",
            run_id: "run-1",
            thread_id: "thread-1",
            thread_title: "CRM dashboard",
          },
        ],
      })
      .mockResolvedValue({ rows: [] });

    const result = await recordComputerHeartbeat({
      tenantId: "tenant-1",
      computerId: "computer-1",
      runtimeStatus: "running",
      runtimeVersion: "runtime-1",
      workspaceRoot: "/workspace",
    });

    expect(result).toMatchObject({ staleRunbookTasksReconciled: 1 });
    expect(mocks.inserts).toContainEqual(
      expect.objectContaining({
        thread_id: "thread-1",
        role: "assistant",
        content: expect.stringContaining(
          "**Stopped:** Generate and save artifact",
        ),
      }),
    );
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        status: "blocked",
        last_response_preview: expect.stringContaining("**Stopped:**"),
      }),
    );
    expect(mocks.notifyNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "message-1",
        threadId: "thread-1",
        role: "assistant",
      }),
    );
    expect(mocks.notifyThreadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        status: "blocked",
      }),
    );
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
      [
        {
          id: "message-1",
          role: "user",
          content: "hello computer",
          metadata: {
            attachments: [
              { attachmentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
            ],
          },
        },
      ],
      [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          s3_key:
            "tenants/tenant-1/attachments/thread-1/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/report.md",
          name: "report.md",
          mime_type: "text/markdown",
          size_bytes: 28,
        },
      ],
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
      requesterContext: {
        contextClass: "system",
        requester: { userId: null },
      },
      computer: { id: "computer-1", name: "Marco", slug: "marco" },
      thread: { id: "thread-1", title: "Hello" },
      message: { id: "message-1", content: "hello computer" },
      model: "model-1",
    });
    expect(mocks.assembleRequesterContext).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        computerId: "computer-1",
        requesterUserId: null,
        prompt: "hello computer",
        sourceSurface: "chat_message",
        contextClass: "system",
      }),
    );
    expect(result.messagesHistory).toHaveLength(2);
    expect(result.attachments).toEqual([
      expect.objectContaining({
        attachmentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "report.md",
        readable: true,
        contentText: "# Report\n\nRevenue grew 12%.",
      }),
    ]);
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
          claimed_at: new Date("2026-05-09T12:00:00.000Z"),
          created_at: new Date("2026-05-09T11:59:00.000Z"),
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
    expect(mocks.inserts).toContainEqual(
      expect.objectContaining({
        event_type: "task_completed",
        task_id: "task-1",
        payload: expect.objectContaining({ source: "chat_message" }),
      }),
    );
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        source_message_id: "assistant-message-1",
      }),
    );
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          response: "Native Computer response",
          responseMessageId: "assistant-message-1",
          usage: { inputTokens: 5 },
        }),
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

  it("records empty native Computer responses so turn completion stays durable", async () => {
    mocks.insertRows = [{ id: "assistant-message-empty" }];
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
      content: "",
    });

    expect(result).toMatchObject({
      responded: true,
      responseMessageId: "assistant-message-empty",
    });
    expect(mocks.inserts).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: "",
        sender_type: "computer",
      }),
    );
  });

  it("returns linked applet ids when a build turn saves directly with save_app", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.updateRows = [[{ id: "applet-1" }]];
    queueThreadTurnRecord("Build a CRM dashboard for my pipeline.");

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "Saved the CRM dashboard.",
      usage: {
        tool_invocations: [
          {
            tool_name: "save_app",
            type: "mcp_tool",
            status: "success",
            output_json: {
              ok: true,
              persisted: true,
              appId: "applet-1",
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      linkedArtifactIds: ["applet-1"],
      linkedArtifactCount: 1,
      artifactSaveMissing: null,
    });
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        output: expect.objectContaining({
          response: "Saved the CRM dashboard.",
          linkedArtifactIds: ["applet-1"],
          linkedArtifactCount: 1,
          artifactSaveMissing: null,
        }),
      }),
    );
  });

  it("allows a build turn when a new applet was linked even without save_app usage evidence", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.updateRows = [[{ id: "applet-1" }]];
    queueThreadTurnRecord("Build a CRM dashboard for my pipeline.");

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "Saved the CRM dashboard.",
      usage: { tool_invocations: [] },
    });

    expect(result).toMatchObject({
      linkedArtifactIds: ["applet-1"],
      linkedArtifactCount: 1,
      artifactSaveMissing: null,
    });
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        content: "Saved the CRM dashboard.",
        metadata: expect.objectContaining({
          artifactSaveMissing: null,
        }),
      }),
    );
  });

  it("records an honest failure when a build turn has no direct save_app or linked applet", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.updateRows = [[]];
    queueThreadTurnRecord("Build a CRM dashboard for my pipeline.");

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "I created the CRM dashboard.",
      usage: { tool_invocations: [] },
    });

    expect(result).toMatchObject({
      linkedArtifactIds: [],
      linkedArtifactCount: 0,
      artifactSaveMissing: {
        reason: "missing_direct_save_app",
        buildStylePrompt: true,
        directSaveAppSucceeded: false,
        linkedArtifactIds: [],
      },
    });
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        content:
          "I generated a dashboard draft but could not save it as an Artifact. Please retry; no applet was created.",
        metadata: expect.objectContaining({
          artifactSaveMissing: expect.objectContaining({
            reason: "missing_direct_save_app",
          }),
        }),
      }),
    );
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          response:
            "I generated a dashboard draft but could not save it as an Artifact. Please retry; no applet was created.",
          artifactSaveMissing: expect.objectContaining({
            reason: "missing_direct_save_app",
          }),
        }),
      }),
    );
    expect(mocks.notifyNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "I generated a dashboard draft but could not save it as an Artifact. Please retry; no applet was created.",
      }),
    );
  });

  it("persists draft preview tool output as a typed message part without linking an artifact", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.updateRows = [[]];
    queueThreadTurnRecord("Build a CRM dashboard for my pipeline.");

    const draftOutput = {
      ok: true,
      type: "draft_app_preview",
      draft: {
        draftId: "draft_123",
        unsaved: true,
        files: { "App.tsx": "export default function App() { return null; }" },
        sourceDigest: "sha256:abc",
        promotionProof: "draft-app-preview-v1:sig",
        validation: { ok: true, status: "passed", errors: [] },
        dataProvenance: { status: "real", notes: ["Loaded live CRM rows."] },
        shadcnProvenance: {
          uiRegistryDigest: "sha256:registry",
          mcpToolCalls: ["list_components", "search_registry"],
        },
      },
    };

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "Here is the draft.",
      usage: {
        tool_invocations: [
          {
            tool_name: "preview_app",
            type: "mcp_tool",
            status: "success",
            tool_use_id: "preview-tool-1",
            input_json: { name: "CRM Draft" },
            output_json: draftOutput,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      linkedArtifactIds: [],
      linkedArtifactCount: 0,
      draftPreviewCount: 1,
      draftPreviewSucceeded: true,
      artifactSaveMissing: null,
    });
    expect(mocks.inserts).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: "Here is the draft.",
        parts: [
          {
            type: "tool-preview_app",
            toolCallId: "preview-tool-1",
            toolName: "preview_app",
            state: "output-available",
            input: { name: "CRM Draft" },
            output: draftOutput,
          },
        ],
      }),
    );
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          response: "Here is the draft.",
          draftPreviewCount: 1,
          draftPreviewSucceeded: true,
          artifactSaveMissing: null,
        }),
      }),
    );
  });

  it("does not count a draft preview without registry evidence as successful output", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.updateRows = [[]];
    queueThreadTurnRecord("Build a CRM dashboard for my pipeline.");

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "Here is the draft.",
      usage: {
        tool_invocations: [
          {
            tool_name: "preview_app",
            type: "mcp_tool",
            status: "success",
            output_json: {
              ok: true,
              type: "draft_app_preview",
              draft: {
                draftId: "draft_123",
                unsaved: true,
                sourceDigest: "sha256:abc",
                promotionProof: "draft-app-preview-v1:sig",
                validation: { ok: true, status: "passed", errors: [] },
                dataProvenance: { status: "real" },
                shadcnProvenance: {
                  uiRegistryDigest: "",
                  mcpToolCalls: [],
                },
              },
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      draftPreviewCount: 1,
      draftPreviewSucceeded: false,
      artifactSaveMissing: expect.objectContaining({
        reason: "missing_direct_save_app",
      }),
    });
  });

  it("does not count a failed-validation draft preview as successful output", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.updateRows = [[]];
    queueThreadTurnRecord("Build a CRM dashboard for my pipeline.");

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "Here is the draft.",
      usage: {
        tool_invocations: [
          {
            tool_name: "preview_app",
            type: "mcp_tool",
            status: "success",
            output_json: {
              ok: false,
              type: "draft_app_preview",
              draft: {
                draftId: "draft_123",
                unsaved: true,
                sourceDigest: "sha256:abc",
                promotionProof: null,
                validation: {
                  ok: false,
                  status: "failed",
                  errors: [{ code: "IMPORT_NOT_ALLOWED" }],
                },
                dataProvenance: { status: "real" },
                shadcnProvenance: {
                  uiRegistryDigest: "sha256:registry",
                  mcpToolCalls: ["list_components"],
                },
              },
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      draftPreviewCount: 1,
      draftPreviewSucceeded: false,
      artifactSaveMissing: expect.objectContaining({
        reason: "missing_direct_save_app",
      }),
    });
  });

  it("leaves non-build turns alone when no applet is linked", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.updateRows = [[]];
    queueThreadTurnRecord("Summarize the current CRM risks.");

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "Here are the CRM risks.",
    });

    expect(result).toMatchObject({
      linkedArtifactIds: [],
      linkedArtifactCount: 0,
      artifactSaveMissing: null,
    });
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        output: expect.objectContaining({
          response: "Here are the CRM risks.",
          artifactSaveMissing: null,
        }),
      }),
    );
  });

  it("does not count delegated save_app-looking output as direct save_app evidence", async () => {
    mocks.insertRows = [{ id: "assistant-message-1" }];
    mocks.updateRows = [[]];
    queueThreadTurnRecord("Create an applet for CRM pipeline risk.");

    const result = await recordThreadTurnResponse({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskId: "task-1",
      content: "A helper saved the applet.",
      usage: {
        tool_invocations: [
          {
            tool_name: "save_app",
            type: "sub_agent",
            status: "success",
            output_json: {
              ok: true,
              persisted: true,
              appId: "applet-1",
            },
          },
        ],
      },
    });

    expect(result.artifactSaveMissing).toMatchObject({
      reason: "missing_direct_save_app",
    });
  });

  it("extracts draft preview parts from output_preview JSON", () => {
    const output = {
      ok: true,
      type: "draft_app_preview",
      draft: { draftId: "draft_123", unsaved: true },
    };

    expect(
      draftPreviewPartsFromUsage({
        tool_invocations: [
          {
            tool_name: "preview_app",
            status: "success",
            output_preview: JSON.stringify(output),
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        type: "tool-preview_app",
        toolName: "preview_app",
        output,
      }),
    ]);
  });

  it("verifies draft preview promotion proofs against source digest and scope", () => {
    const files = {
      "App.tsx": "export default function App() { return null; }",
    };
    const sourceDigest = buildDraftAppletSourceDigest(files);
    const expiresAt = "2026-05-13T12:00:00.000Z";
    const proof =
      "draft-app-preview-v1:" +
      "78b1227ce98b7374678ba420e0fd3f35bf0e8edc473afbb0d82f128acaa6f4d5";

    expect(
      verifyDraftAppletPromotionProof({
        tenantId: "tenant-1",
        computerId: "computer-1",
        threadId: "thread-1",
        draftId: "draft_123",
        sourceDigest,
        expiresAt,
        promotionProof: proof,
        secret: "secret",
        now: new Date("2026-05-13T11:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      verifyDraftAppletPromotionProof({
        tenantId: "tenant-1",
        computerId: "computer-1",
        threadId: "thread-1",
        draftId: "draft_123",
        sourceDigest: buildDraftAppletSourceDigest({
          "App.tsx": "export default function Changed() { return null; }",
        }),
        expiresAt,
        promotionProof: proof,
        secret: "secret",
        now: new Date("2026-05-13T11:00:00.000Z"),
      }),
    ).toBe(false);
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

function queueThreadTurnRecord(prompt: string) {
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
        claimed_at: new Date("2026-05-09T12:00:00.000Z"),
        created_at: new Date("2026-05-09T11:59:00.000Z"),
      },
    ],
    [{ id: "thread-1", title: "Hello", status: "in_progress" }],
    [{ id: "message-1", role: "user", content: prompt }],
  ];
}
