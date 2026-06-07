import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeAgentNotFoundError extends Error {
    constructor(public readonly agentId: string) {
      super(`Agent not found: ${agentId}`);
      this.name = "AgentNotFoundError";
    }
  }

  class FakeModelApprovalError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ModelApprovalError";
    }
  }

  return {
    FakeAgentNotFoundError,
    FakeModelApprovalError,
    resolveAgentRuntimeConfig: vi.fn(),
    assertUserModelApproved: vi.fn(),
    listApprovedModelCatalog: vi.fn(),
    lambdaSend: vi.fn(),
    selectRows: [] as Array<Array<Record<string, unknown>>>,
    insertValues: [] as Array<Record<string, unknown>>,
    updateValues: [] as Array<Record<string, unknown>>,
    notifyThreadTurnUpdate: vi.fn(),
    notifyNewMessage: vi.fn(),
    insertAssistantMessage: vi.fn(),
    markComputerTaskFailedFromFinalize: vi.fn(),
    checkUserBudgetAndPauseWork: vi.fn(),
  };
});

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => queryRows(),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        mocks.insertValues.push(value);
        return {
          returning: async () => [{ id: "turn-pi-1" }],
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updateValues.push(value);
        const chain = {
          where: () => chain,
          returning: async () => [{ id: "turn-mobile-1" }],
          then: (
            resolve: (value: Array<Record<string, unknown>>) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise.resolve([]).then(resolve, reject),
        };
        return chain;
      },
    }),
  }),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(() => ({ send: mocks.lambdaSend })),
  InvokeCommand: vi.fn((input) => ({ input })),
}));

vi.mock("../lib/resolve-agent-runtime-config.js", () => ({
  AgentNotFoundError: mocks.FakeAgentNotFoundError,
  resolveAgentRuntimeConfig: mocks.resolveAgentRuntimeConfig,
  tenantCatalogSkillS3Key: (tenantSlug: string, skillId: string) =>
    `tenants/${tenantSlug}/skill-catalog/${skillId}`,
}));

vi.mock("../lib/sandbox-preflight.js", () => ({
  applySandboxPayloadFields: vi.fn(),
  checkSandboxPreflight: vi.fn(),
}));

vi.mock("../lib/chat-finalize/notify.js", () => ({
  GENERIC_AGENT_ERROR_MESSAGE: "Agent failed",
  insertAssistantMessage: mocks.insertAssistantMessage,
  markComputerTaskFailedFromFinalize: mocks.markComputerTaskFailedFromFinalize,
  notifyNewMessage: mocks.notifyNewMessage,
  notifyThreadTurnUpdate: mocks.notifyThreadTurnUpdate,
}));

vi.mock("../lib/user-budget-enforcement.js", () => ({
  checkUserBudgetAndPauseWork: mocks.checkUserBudgetAndPauseWork,
}));

vi.mock("../lib/model-approvals.js", () => ({
  assertUserModelApproved: mocks.assertUserModelApproved,
  listApprovedModelCatalog: mocks.listApprovedModelCatalog,
  ModelApprovalError: mocks.FakeModelApprovalError,
}));

function queryRows() {
  const rows = () => Promise.resolve(mocks.selectRows.shift() ?? []);
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => rows(),
    then: (
      resolve: (value: Array<Record<string, unknown>>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => rows().then(resolve, reject),
  };
  return chain;
}

function decodeInvokeBody(command: { input: { Payload?: Uint8Array } }) {
  const wrapperJson = new TextDecoder().decode(command.input.Payload);
  const wrapper = JSON.parse(wrapperJson) as { body: string };
  return JSON.parse(wrapper.body) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("AGENTCORE_FUNCTION_NAME", "strands-runtime-fn");
  vi.stubEnv("AGENTCORE_PI_FUNCTION_NAME", "pi-runtime-fn");
  vi.stubEnv("WORKSPACE_RENDERER_FUNCTION_NAME", "");
  vi.stubEnv("THINKWORK_API_URL", "https://api.example.com");
  vi.stubEnv("THINKWORK_API_SECRET", "test-secret");
  mocks.selectRows = [
    [{ sender_id: "user-1", sender_type: "human" }],
    [{ email: "user-1@example.com" }],
    [{ spaceId: null }],
    [{ count: 0 }],
    [],
  ];
  mocks.insertValues = [];
  mocks.updateValues = [];
  mocks.lambdaSend.mockResolvedValue({});
  mocks.assertUserModelApproved.mockResolvedValue(undefined);
  mocks.listApprovedModelCatalog.mockResolvedValue([
    { modelId: "us.amazon.nova-micro-v1:0" },
  ]);
  mocks.checkUserBudgetAndPauseWork.mockResolvedValue({
    overBudget: false,
    pauseReason: null,
    status: {
      hasPolicy: false,
      overBudget: false,
      limitUsd: null,
      spentUsd: 0,
      remainingUsd: null,
    },
  });
  mocks.resolveAgentRuntimeConfig.mockResolvedValue({
    tenantId: "tenant-1",
    agentId: "agent-1",
    agentName: "ThinkWork",
    agentSlug: "thinkwork",
    agentSystemPrompt: null,
    humanName: undefined,
    humanPairId: null,
    tenantSlug: "acme",
    templateId: null,
    templateModel: "moonshotai.kimi-k2.5",
    runtimeType: "pi",
    budgetMonthlyCents: null,
    budgetPaused: false,
    blockedTools: [],
    sandboxTemplate: null,
    browserAutomationEnabled: true,
    contextEngineEnabled: false,
    guardrailId: null,
    guardrailConfig: undefined,
    skillsConfig: [],
    knowledgeBasesConfig: undefined,
    mcpConfigs: [],
    agentProfilesConfig: [],
  });
});

describe("chat-agent-invoke runtime routing", () => {
  it("dispatches Computer-backed Pi agent turns to the Pi AgentCore runtime", async () => {
    const { handler } = await import("./chat-agent-invoke.js");

    await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "what are the last 5 opportunities in the CRM?",
      messageId: "message-1",
      computerId: "computer-1",
      computerTaskId: "task-1",
    });

    expect(mocks.insertValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: "tenant-1",
          agent_id: "agent-1",
          thread_id: "thread-1",
          runtime_type: "pi",
          context_snapshot: expect.objectContaining({
            dispatcher: "chat-agent-invoke",
            runtime_type: "pi",
          }),
        }),
      ]),
    );

    expect(mocks.lambdaSend).toHaveBeenCalledTimes(1);
    const command = mocks.lambdaSend.mock.calls[0][0] as {
      input: {
        FunctionName: string;
        InvocationType: string;
        Payload: Uint8Array;
      };
    };
    expect(command.input).toMatchObject({
      FunctionName: "pi-runtime-fn",
      InvocationType: "Event",
    });

    const body = decodeInvokeBody(command);
    expect(body).toMatchObject({
      runtime_type: "pi",
      assistant_id: "agent-1",
      thread_id: "thread-1",
      computer_id: "computer-1",
      computer_task_id: "task-1",
      computer_response_mode: "thread_turn",
      browser_automation_enabled: true,
      thread_turn_id: "turn-pi-1",
      finalize_callback_url:
        "https://api.example.com/api/threads/thread-1/finalize",
      finalize_callback_secret: "test-secret",
      cost_owner_user_id: "user-1",
    });
  });

  it("blocks dispatch when the initiating user is already over budget", async () => {
    mocks.checkUserBudgetAndPauseWork.mockResolvedValueOnce({
      overBudget: true,
      pauseReason: "User budget exceeded: $12.50 >= $10.00",
      status: {
        hasPolicy: true,
        overBudget: true,
        limitUsd: 10,
        spentUsd: 12.5,
        remainingUsd: 0,
      },
    });
    mocks.insertAssistantMessage.mockResolvedValueOnce({
      id: "message-budget-1",
    });
    const { handler } = await import("./chat-agent-invoke.js");

    const result = await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "run something expensive",
      messageId: "message-1",
    });

    expect(result).toEqual({ ok: false, threadTurnId: "turn-pi-1" });
    expect(mocks.checkUserBudgetAndPauseWork).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(mocks.lambdaSend).not.toHaveBeenCalled();
    expect(mocks.insertAssistantMessage).toHaveBeenCalledWith(
      "thread-1",
      "tenant-1",
      "agent-1",
      "User budget exceeded: $12.50 >= $10.00",
    );
    expect(mocks.notifyNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "message-budget-1",
        content: "User budget exceeded: $12.50 >= $10.00",
      }),
    );
    expect(mocks.updateValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          error: "User budget exceeded: $12.50 >= $10.00",
          error_code: "agentcore_setup_failed",
        }),
      ]),
    );
  });

  it("passes active Space context even when workspace rendering is skipped", async () => {
    mocks.selectRows = [
      [{ sender_id: "user-1", sender_type: "human" }],
      [{ email: "user-1@example.com" }],
      [{ spaceId: "space-1" }],
      [{ slug: "customer-onboarding" }],
      [{ count: 0 }],
      [],
    ];
    const { handler } = await import("./chat-agent-invoke.js");

    await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "email me the thread status",
      messageId: "message-1",
    });

    const command = mocks.lambdaSend.mock.calls[0][0] as {
      input: {
        Payload: Uint8Array;
      };
    };
    const body = decodeInvokeBody(command);

    expect(body.turn_context).toMatchObject({
      spaceId: "space-1",
      tenantSlug: "acme",
      spaceSlug: "customer-onboarding",
    });
    expect(body.current_user_email).toBe("user-1@example.com");
  });

  it("uses the selected parent model for the turn context and Pi payload", async () => {
    const { handler } = await import("./chat-agent-invoke.js");

    await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "Use the cheaper approved model",
      messageId: "message-1",
      requestedModelId: "anthropic.claude-haiku",
    });

    expect(mocks.assertUserModelApproved).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      modelId: "anthropic.claude-haiku",
    });
    expect(mocks.insertValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          context_snapshot: expect.objectContaining({
            model: "anthropic.claude-haiku",
            requested_model: "anthropic.claude-haiku",
            fallback_model: "moonshotai.kimi-k2.5",
          }),
        }),
      ]),
    );
    const command = mocks.lambdaSend.mock.calls[0][0] as {
      input: { Payload: Uint8Array };
    };
    const body = decodeInvokeBody(command);
    expect(body.model).toBe("anthropic.claude-haiku");
  });

  it("rejects direct selected-model dispatch when the user is not approved", async () => {
    mocks.assertUserModelApproved.mockRejectedValueOnce(
      new mocks.FakeModelApprovalError(
        "MODEL_NOT_APPROVED",
        "Model is not approved for this user.",
      ),
    );
    const { handler } = await import("./chat-agent-invoke.js");

    const result = await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "Use an unapproved model",
      messageId: "message-1",
      modelId: "anthropic.claude-haiku",
    });

    expect(result).toEqual({ ok: false, threadTurnId: undefined });
    expect(mocks.assertUserModelApproved).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      modelId: "anthropic.claude-haiku",
    });
    expect(mocks.insertValues).toEqual([]);
    expect(mocks.lambdaSend).not.toHaveBeenCalled();
  });

  it("passes effective TOOLS.md model routes and approved model ids to Pi", async () => {
    vi.stubEnv("WORKSPACE_RENDERER_FUNCTION_NAME", "workspace-renderer-fn");
    mocks.selectRows = [
      [{ sender_id: "user-1", sender_type: "human" }],
      [{ email: "user-1@example.com" }],
      [{ spaceId: "space-1" }],
      [{ slug: "research" }],
      [{ count: 0 }],
      [],
    ];
    mocks.lambdaSend
      .mockResolvedValueOnce({
        Payload: new TextEncoder().encode(
          JSON.stringify({
            ok: true,
            renderedPrefix: "spaces/research/thread-1",
            activeSpace: {
              id: "space-1",
              slug: "research",
              name: "Research",
              isDefault: false,
            },
            effectivePolicy: {
              blockedTools: [],
              allowedTools: null,
              mcpAllowedServers: null,
              mcpBlockedServers: [],
              modelRouting: [
                {
                  tool: "workspace_skill",
                  match: { slug: "research" },
                  model: "us.amazon.nova-micro-v1:0",
                  sourceOwner: "user",
                  sourcePath: "/workspace/User/TOOLS.md",
                  precedence: 300,
                },
              ],
              diagnostics: [],
            },
            cacheStatus: "miss",
          }),
        ),
      })
      .mockResolvedValueOnce({});
    const { handler } = await import("./chat-agent-invoke.js");

    await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "Use the routed skill",
      messageId: "message-1",
    });

    expect(mocks.listApprovedModelCatalog).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    const command = mocks.lambdaSend.mock.calls[1][0] as {
      input: { Payload: Uint8Array };
    };
    const body = decodeInvokeBody(command);
    expect(body.model_routing_policy).toEqual({
      routes: [
        {
          tool: "workspace_skill",
          match: { slug: "research" },
          model: "us.amazon.nova-micro-v1:0",
          sourceOwner: "user",
          sourcePath: "/workspace/User/TOOLS.md",
          precedence: 300,
        },
      ],
    });
    expect(body.approved_model_ids).toEqual(["us.amazon.nova-micro-v1:0"]);
  });

  it("marks desktop managed delegation turns with parent provenance and returns the child turn id", async () => {
    const { handler } = await import("./chat-agent-invoke.js");

    const result = await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "Run hosted work",
      messageId: "message-1",
      desktopDelegation: {
        parentThreadTurnId: "parent-turn-1",
        requestedVisibility: "hidden",
        effectiveVisibility: "hidden",
        reason: "needs hosted worker",
      },
    });

    expect(result).toEqual({ ok: true, threadTurnId: "turn-pi-1" });
    expect(mocks.insertValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          invocation_source: "desktop_managed_delegation",
          origin_turn_id: "parent-turn-1",
          trigger_detail: "needs hosted worker",
          context_snapshot: expect.objectContaining({
            dispatcher: "desktop-managed-delegation",
            desktop_managed_delegation: expect.objectContaining({
              parent_thread_turn_id: "parent-turn-1",
              visibility: "hidden",
            }),
          }),
        }),
      ]),
    );
  });

  it("dispatches managed mobile handoff using the existing thread turn id", async () => {
    mocks.selectRows = [
      [{ sender_id: "user-1", sender_type: "human" }],
      [{ email: "user-1@example.com" }],
      [{ spaceId: null }],
      [],
    ];
    const { handler } = await import("./chat-agent-invoke.js");

    const result = await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "Continue from mobile checkpoint",
      messageId: "message-1",
      existingThreadTurnId: "turn-mobile-1",
      mobileHandoff: {
        checkpointSeq: 2,
        latestObservedCheckpointSeq: 3,
        unsafeCheckpointSkipped: true,
      },
    });

    expect(result).toEqual({ ok: true, threadTurnId: "turn-mobile-1" });
    expect(mocks.insertValues).toEqual([]);
    expect(mocks.updateValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          context_snapshot: expect.anything(),
          last_activity_at: expect.any(Date),
        }),
      ]),
    );

    const command = mocks.lambdaSend.mock.calls[0][0] as {
      input: {
        FunctionName: string;
        InvocationType: string;
        Payload: Uint8Array;
      };
    };
    expect(command.input).toMatchObject({
      FunctionName: "pi-runtime-fn",
      InvocationType: "Event",
    });

    const body = decodeInvokeBody(command);
    expect(body).toMatchObject({
      runtime_type: "pi",
      thread_turn_id: "turn-mobile-1",
      message: "Continue from mobile checkpoint",
      finalize_callback_url:
        "https://api.example.com/api/threads/thread-1/finalize",
      finalize_callback_secret: "test-secret",
    });
  });

  it("passes Web Extraction config only when Space allowed-tools policy permits its alias", async () => {
    vi.stubEnv("WORKSPACE_RENDERER_FUNCTION_NAME", "workspace-renderer-fn");
    mocks.selectRows = [
      [{ sender_id: "user-1", sender_type: "human" }],
      [{ email: "user-1@example.com" }],
      [{ spaceId: "space-1" }],
      [{ slug: "research" }],
      [{ count: 0 }],
      [],
    ];
    mocks.resolveAgentRuntimeConfig.mockResolvedValueOnce({
      tenantId: "tenant-1",
      agentId: "agent-1",
      agentName: "ThinkWork",
      agentSlug: "thinkwork",
      agentSystemPrompt: null,
      humanName: undefined,
      humanPairId: null,
      tenantSlug: "acme",
      templateId: null,
      templateModel: "moonshotai.kimi-k2.5",
      runtimeType: "pi",
      budgetMonthlyCents: null,
      budgetPaused: false,
      blockedTools: [],
      sandboxTemplate: null,
      browserAutomationEnabled: true,
      contextEngineEnabled: true,
      contextEngineConfig: { enabled: true },
      webSearchConfig: { provider: "exa", apiKey: "exa-key" },
      webExtractConfig: {
        toolSlug: "web-extract",
        provider: "firecrawl",
        apiKey: "fc-key",
        config: { onlyMainContent: true },
      },
      sendEmailConfig: {
        agentId: "agent-1",
        tenantId: "tenant-1",
        apiUrl: "https://api.example.com",
        apiSecret: "test-secret",
      },
      guardrailId: null,
      guardrailConfig: undefined,
      skillsConfig: [
        {
          skillId: "web-search",
          s3Key: "tenants/acme/skill-catalog/web-search",
        },
        {
          skillId: "custom-research-skill",
          s3Key:
            "tenants/acme/agents/thinkwork/workspace/skills/custom-research-skill",
        },
      ],
      knowledgeBasesConfig: undefined,
      mcpConfigs: [],
      agentProfilesConfig: [],
    });
    mocks.lambdaSend
      .mockResolvedValueOnce({
        Payload: new TextEncoder().encode(
          JSON.stringify({
            ok: true,
            renderedPrefix: "spaces/research/thread-1",
            activeSpace: {
              id: "space-1",
              slug: "research",
              name: "Research",
              isDefault: false,
            },
            effectivePolicy: {
              blockedTools: [],
              allowedTools: ["web_extract"],
              mcpAllowedServers: null,
              mcpBlockedServers: [],
              diagnostics: [],
            },
            cacheStatus: "miss",
          }),
        ),
      })
      .mockResolvedValueOnce({});
    const { handler } = await import("./chat-agent-invoke.js");

    await handler({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userMessage: "Extract the current page",
      messageId: "message-1",
    });

    expect(mocks.lambdaSend).toHaveBeenCalledTimes(2);
    const command = mocks.lambdaSend.mock.calls[1][0] as {
      input: {
        Payload: Uint8Array;
      };
    };
    const body = decodeInvokeBody(command);

    expect(body.web_extract_config).toEqual({
      toolSlug: "web-extract",
      provider: "firecrawl",
      apiKey: "fc-key",
      config: { onlyMainContent: true },
    });
    expect(body.web_search_config).toBeUndefined();
    expect(body.send_email_config).toBeUndefined();
    expect(body.context_engine_config).toBeUndefined();
    expect(body.browser_automation_enabled).toBeUndefined();
    expect(body.skills).toEqual([
      {
        skillId: "custom-research-skill",
        s3Key:
          "tenants/acme/agents/thinkwork/workspace/skills/custom-research-skill",
      },
    ]);
  });
});
