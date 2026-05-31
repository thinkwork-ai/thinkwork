import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeAgentNotFoundError extends Error {
    constructor(public readonly agentId: string) {
      super(`Agent not found: ${agentId}`);
      this.name = "AgentNotFoundError";
    }
  }

  return {
    FakeAgentNotFoundError,
    resolveAgentRuntimeConfig: vi.fn(),
    lambdaSend: vi.fn(),
    selectRows: [] as Array<Array<Record<string, unknown>>>,
    insertValues: [] as Array<Record<string, unknown>>,
    updateValues: [] as Array<Record<string, unknown>>,
    notifyThreadTurnUpdate: vi.fn(),
    notifyNewMessage: vi.fn(),
    insertAssistantMessage: vi.fn(),
    markComputerTaskFailedFromFinalize: vi.fn(),
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
    });
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
});
