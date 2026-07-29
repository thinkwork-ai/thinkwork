/**
 * THINK-324 C5 — pre-dispatch thread checkout in chat-agent-invoke.
 *
 * A live concurrent turn on the thread must defer the new message as a
 * deferred wakeup instead of racing a second runtime turn; a free (or
 * stale-held) thread claims the lease and dispatches normally.
 */
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
    claimThreadCheckout: vi.fn(),
    releaseThreadCheckout: vi.fn(),
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

vi.mock("../lib/thread-checkout.js", () => ({
  claimThreadCheckout: mocks.claimThreadCheckout,
  releaseThreadCheckout: mocks.releaseThreadCheckout,
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

const BASE_EVENT = {
  tenantId: "tenant-1",
  threadId: "thread-1",
  agentId: "agent-1",
  userMessage: "second message while the agent is replying",
  messageId: "message-2",
};

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
  mocks.claimThreadCheckout.mockResolvedValue(true);
  mocks.releaseThreadCheckout.mockResolvedValue(undefined);
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
    threadJsonRenderUiEnabled: false,
    contextEngineEnabled: false,
    guardrailId: null,
    guardrailConfig: undefined,
    skillsConfig: [],
    mcpConfigs: [],
    agentProfilesConfig: [],
  });
});

describe("chat-agent-invoke — pre-dispatch thread checkout (THINK-324 C5)", () => {
  it("defers the message as a deferred wakeup when a live turn holds the thread", async () => {
    mocks.claimThreadCheckout.mockResolvedValue(false);
    const { handler } = await import("./chat-agent-invoke.js");

    const result = (await handler(BASE_EVENT)) as Record<string, unknown>;

    expect(result).toMatchObject({ ok: false, deferred: true });
    // No runtime dispatch, no turn row.
    expect(mocks.lambdaSend).not.toHaveBeenCalled();
    expect(
      mocks.insertValues.filter((v) => v.status === "running"),
    ).toHaveLength(0);
    // Exactly one deferred chat_message wakeup with the promotion-matching
    // TOP-LEVEL payload.threadId.
    const wakeups = mocks.insertValues.filter((v) => v.status === "deferred");
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]).toMatchObject({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      source: "chat_message",
      status: "deferred",
      payload: expect.objectContaining({
        threadId: "thread-1",
        messageId: "message-2",
        userMessage: BASE_EVENT.userMessage,
      }),
    });
  });

  it("claims the checkout with the new turn id and dispatches when the thread is free", async () => {
    const { handler } = await import("./chat-agent-invoke.js");

    await handler(BASE_EVENT);

    expect(mocks.claimThreadCheckout).toHaveBeenCalledTimes(1);
    const claimArgs = mocks.claimThreadCheckout.mock.calls[0][0] as {
      tenantId: string;
      threadId: string;
      runId: string;
    };
    expect(claimArgs).toMatchObject({
      tenantId: "tenant-1",
      threadId: "thread-1",
    });
    // The turn row is created with the SAME id the claim holds, so the
    // finalize-side release (keyed by turn id) matches the lease.
    const turnInsert = mocks.insertValues.find((v) => v.status === "running");
    expect(turnInsert).toBeDefined();
    expect(turnInsert?.id).toBe(claimArgs.runId);
    expect(mocks.lambdaSend).toHaveBeenCalledTimes(1);
  });

  it("fails open and dispatches when the claim itself errors", async () => {
    mocks.claimThreadCheckout.mockRejectedValue(new Error("db down"));
    const { handler } = await import("./chat-agent-invoke.js");

    await handler(BASE_EVENT);

    expect(mocks.lambdaSend).toHaveBeenCalledTimes(1);
    expect(
      mocks.insertValues.filter((v) => v.status === "deferred"),
    ).toHaveLength(0);
  });

  it("skips the claim entirely for ask-mode turns (never rides the wakeup fallback)", async () => {
    const { handler } = await import("./chat-agent-invoke.js");

    await handler({ ...BASE_EVENT, askMode: true });

    expect(mocks.claimThreadCheckout).not.toHaveBeenCalled();
    expect(mocks.lambdaSend).toHaveBeenCalledTimes(1);
  });

  it("skips the claim when the event has no messageId (nothing to defer against)", async () => {
    mocks.claimThreadCheckout.mockResolvedValue(false);
    const { handler } = await import("./chat-agent-invoke.js");

    await handler({ ...BASE_EVENT, messageId: undefined });

    expect(mocks.claimThreadCheckout).not.toHaveBeenCalled();
    expect(mocks.lambdaSend).toHaveBeenCalledTimes(1);
  });
});
