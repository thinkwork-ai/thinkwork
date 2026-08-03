/**
 * U2 of plan 2026-08-03-001 (THINK-583) — R12 characterization.
 *
 * Pins the exact dispatch payload chat-agent-invoke sends to the runtime for
 * a fixed fixture, so the setup-diet restructuring (parallelized awaits,
 * render-skip) can be proven byte-identical. The DB mock dispatches on table
 * identity + selected fields — NOT call order — so reordering awaits does not
 * invalidate the fixture.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";

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
    assertUserModelApproved: vi.fn(),
    listApprovedModelCatalog: vi.fn(),
    lambdaInvokes: [] as Array<{ FunctionName?: string; Payload?: Uint8Array }>,
    rendererResponse: null as Record<string, unknown> | null,
    notifyThreadTurnUpdate: vi.fn(),
    notifyNewMessage: vi.fn(),
    insertAssistantMessage: vi.fn(),
    markComputerTaskFailedFromFinalize: vi.fn(),
    checkUserBudgetAndPauseWork: vi.fn(),
    claimThreadCheckout: vi.fn(),
    releaseThreadCheckout: vi.fn(),
    insertValues: [] as Array<Record<string, unknown>>,
  };
});

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: (fields?: Record<string, unknown>) => {
      const chain: Record<string, unknown> = {};
      let table: unknown = null;
      const rows = () => Promise.resolve(resolveSelect(table, fields));
      Object.assign(chain, {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => rows(),
        then: (
          resolve: (value: Array<Record<string, unknown>>) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => rows().then(resolve, reject),
      });
      return chain;
    },
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        mocks.insertValues.push(value);
        return {
          returning: async () => [
            { id: (value.id as string) ?? "turn-fixed-1" },
          ],
        };
      },
    }),
    update: () => ({
      set: () => {
        const chain = {
          where: () => chain,
          returning: async () => [{ id: "turn-fixed-1" }],
          then: (
            resolve: (value: Array<Record<string, unknown>>) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise.resolve([]).then(resolve, reject),
        };
        return chain;
      },
    }),
    execute: async () => [],
  }),
}));

let overrideThreadsRow: Record<string, unknown> | null = null;

function tableName(table: unknown): string {
  try {
    return getTableName(table as Table);
  } catch {
    return "";
  }
}

function resolveSelect(
  table: unknown,
  fields?: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const fieldKeys = fields ? Object.keys(fields) : [];
  const name = tableName(table);
  if (name === "messages") {
    if (fieldKeys.includes("role") && fieldKeys.includes("content")) {
      return [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier reply" },
      ];
    }
    return [{ sender_id: "user-1", sender_type: "human" }];
  }
  if (name === "threads") {
    if (fieldKeys.some((k) => k.toLowerCase().includes("metadata"))) {
      return [];
    }
    return [overrideThreadsRow ?? { spaceId: "space-1" }];
  }
  if (name === "spaces") {
    return [{ slug: "main-space" }];
  }
  if (name === "thread_turns") {
    return [{ count: 3 }];
  }
  if (name === "users" || fieldKeys.includes("email")) {
    return [{ email: "user-1@example.com" }];
  }
  return [];
}

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(() => ({
    send: async (cmd: {
      input: { FunctionName?: string; Payload?: Uint8Array };
    }) => {
      mocks.lambdaInvokes.push(cmd.input);
      if (cmd.input.FunctionName === "renderer-fn") {
        return {
          Payload: new TextEncoder().encode(
            JSON.stringify(mocks.rendererResponse ?? {}),
          ),
        };
      }
      return {};
    },
  })),
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
  ModelApprovalError: class extends Error {},
}));

vi.mock("../lib/thread-checkout.js", () => ({
  claimThreadCheckout: mocks.claimThreadCheckout,
  releaseThreadCheckout: mocks.releaseThreadCheckout,
}));

const BASE_EVENT = {
  tenantId: "tenant-1",
  threadId: "thread-1",
  agentId: "agent-1",
  userMessage: "characterization fixture message",
  messageId: "message-2",
};

const RENDERER_RESPONSE = {
  ok: true,
  statusCode: 200,
  renderedPrefix: "tenants/acme/threads/thread-1/",
  cacheStatus: "miss",
  sourcePrefixes: [
    "tenants/acme/agents/agent-1/",
    "tenants/acme/spaces/main-space/",
  ],
  activeSpace: {
    id: "space-1",
    slug: "main-space",
    name: "Main",
    isDefault: true,
  },
  effectivePolicy: {
    blockedTools: [],
    allowedTools: null,
    mcpAllowedServers: null,
    mcpBlockedServers: [],
    modelRouting: [],
    diagnostics: [],
  },
  capabilities: {
    fingerprint: "cap-fp-1",
    path: "capabilities/cap-fp-1.json",
    manifest: null,
  },
  hydrateManifest: {
    version: 1,
    generatedAt: "2026-08-03T00:00:00.000Z",
    files: [],
  },
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.lambdaInvokes = [];
  mocks.insertValues = [];
  mocks.rendererResponse = RENDERER_RESPONSE;
  vi.stubEnv("AGENTCORE_PI_FUNCTION_NAME", "pi-runtime-fn");
  vi.stubEnv("WORKSPACE_RENDERER_FUNCTION_NAME", "renderer-fn");
  vi.stubEnv("THINKWORK_API_URL", "https://api.example.com");
  vi.stubEnv("THINKWORK_API_SECRET", "test-secret");
  vi.stubEnv("WORKSPACE_BUCKET", "workspace-bucket-test");
  vi.stubEnv("_X_AMZN_TRACE_ID", "Root=1-fixed-trace;Parent=p;Sampled=1");
  vi.stubEnv("TURN_ASSERTION_KMS_KEY_ID", "");
  mocks.claimThreadCheckout.mockResolvedValue(true);
  mocks.releaseThreadCheckout.mockResolvedValue(undefined);
  mocks.assertUserModelApproved.mockResolvedValue(undefined);
  mocks.listApprovedModelCatalog.mockResolvedValue([]);
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
    agentSystemPrompt: "You are the fixture agent.",
    humanName: "Eric",
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
    skillsConfig: [
      {
        skillId: "meeting-notes",
        s3Key: "tenants/acme/skill-catalog/meeting-notes",
      },
    ],
    mcpConfigs: [],
    agentProfilesConfig: [],
    piExtensions: undefined,
    capabilityFolderDispatch: false,
    webSearchConfig: undefined,
    webExtractConfig: undefined,
    sendEmailConfig: undefined,
    contextEngineConfig: undefined,
  });
});

function dispatchedRuntimePayload(): Record<string, unknown> {
  const dispatch = mocks.lambdaInvokes.find(
    (call) => call.FunctionName === "pi-runtime-fn",
  );
  expect(dispatch, "runtime dispatch invoke").toBeTruthy();
  const outer = JSON.parse(new TextDecoder().decode(dispatch!.Payload));
  return JSON.parse(outer.body);
}

describe("chat-agent-invoke — R12 dispatch payload characterization", () => {
  it("dispatches the pinned payload for the rendered-workspace fixture", async () => {
    const { handler } = await import("./chat-agent-invoke.js");
    await handler(BASE_EVENT);
    const payload = normalizeTurnScopedFields(dispatchedRuntimePayload());
    expect(payload).toMatchSnapshot();
  });

  it("dispatches the pinned payload when the thread has no space (no render)", async () => {
    mocks.rendererResponse = null;
    overrideThreadsRow = { spaceId: null };
    try {
      const { handler } = await import("./chat-agent-invoke.js");
      await handler(BASE_EVENT);
    } finally {
      overrideThreadsRow = null;
    }
    const payload = normalizeTurnScopedFields(dispatchedRuntimePayload());
    expect(payload).toMatchSnapshot();
  });
});

/**
 * The turn id is client-generated (randomUUID) when checkout-eligible, so
 * any payload field carrying it is normalized to a stable token before the
 * snapshot compare. Everything else must be byte-identical.
 */
function normalizeTurnScopedFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const turnId = mocks.insertValues.find((v) => "thread_id" in v)?.id as
    | string
    | undefined;
  if (!turnId) return out;
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.split(turnId).join("<turn-id>");
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          scrub(v),
        ]),
      );
    }
    return value;
  };
  return scrub(out) as Record<string, unknown>;
}
