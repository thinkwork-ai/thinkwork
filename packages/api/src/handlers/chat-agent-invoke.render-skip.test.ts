/**
 * U2 of plan 2026-08-03-001 (THINK-583) — render-skip wiring in
 * chat-agent-invoke. The skip decision logic itself is covered in
 * src/lib/workspace-render-skip.test.ts (including the must-not-skip
 * scenarios: memory written between turns, goal/notes edits — both surface
 * as sources_changed via the S3 mtime probe). These tests pin the handler
 * wiring: a skip verdict carries the persisted render values and never
 * invokes the renderer; a corrupt marker falls back to a full render.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";

const mocks = vi.hoisted(() => {
  class FakeAgentNotFoundError extends Error {}
  return {
    FakeAgentNotFoundError,
    resolveAgentRuntimeConfig: vi.fn(),
    assertUserModelApproved: vi.fn(),
    listApprovedModelCatalog: vi.fn(),
    lambdaInvokes: [] as Array<{ FunctionName?: string; Payload?: Uint8Array }>,
    rendererResponse: {} as Record<string, unknown>,
    notifyThreadTurnUpdate: vi.fn(),
    notifyNewMessage: vi.fn(),
    insertAssistantMessage: vi.fn(),
    markComputerTaskFailedFromFinalize: vi.fn(),
    checkUserBudgetAndPauseWork: vi.fn(),
    claimThreadCheckout: vi.fn(),
    releaseThreadCheckout: vi.fn(),
    readThreadLastRender: vi.fn(),
    writeThreadLastRender: vi.fn(),
    computeRoutingSignature: vi.fn(),
    evaluateRenderSkip: vi.fn(),
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
      values: (value: Record<string, unknown>) => ({
        returning: async () => [{ id: (value.id as string) ?? "turn-1" }],
      }),
    }),
    update: () => ({
      set: () => {
        const chain = {
          where: () => chain,
          returning: async () => [{ id: "turn-1" }],
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

function resolveSelect(
  table: unknown,
  fields?: Record<string, unknown>,
): Array<Record<string, unknown>> {
  let name = "";
  try {
    name = getTableName(table as Table);
  } catch {
    name = "";
  }
  const fieldKeys = fields ? Object.keys(fields) : [];
  if (name === "messages") {
    if (fieldKeys.includes("role") && fieldKeys.includes("content")) return [];
    return [{ sender_id: "user-1", sender_type: "human" }];
  }
  if (name === "threads") return [{ spaceId: "space-1" }];
  if (name === "spaces") return [{ slug: "main-space" }];
  if (name === "thread_turns") return [{ count: 3 }];
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
            JSON.stringify(mocks.rendererResponse),
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

vi.mock("../lib/workspace-render-skip.js", () => ({
  THREAD_LAST_RENDER_VERSION: 1,
  readThreadLastRender: mocks.readThreadLastRender,
  writeThreadLastRender: mocks.writeThreadLastRender,
  computeRoutingSignature: mocks.computeRoutingSignature,
  evaluateRenderSkip: mocks.evaluateRenderSkip,
}));

const BASE_EVENT = {
  tenantId: "tenant-1",
  threadId: "thread-1",
  agentId: "agent-1",
  userMessage: "follow-up message",
  messageId: "message-2",
};

const MARKER = {
  version: 1,
  generatedAt: "2026-08-03T12:00:00.000Z",
  renderedPrefix: "tenants/acme/threads/thread-1/",
  sourcePrefixes: ["tenants/acme/agents/agent-1/"],
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
  capabilities: { fingerprint: "cap-fp-1", manifest: null },
  hydrateManifest: {
    version: 1,
    generatedAt: "2026-08-03T12:00:00.000Z",
    files: [],
  },
  routingSignature: "sig-1",
  configFingerprint: "cfg-1",
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.lambdaInvokes = [];
  vi.stubEnv("AGENTCORE_PI_FUNCTION_NAME", "pi-runtime-fn");
  vi.stubEnv("WORKSPACE_RENDERER_FUNCTION_NAME", "renderer-fn");
  vi.stubEnv("THINKWORK_API_URL", "https://api.example.com");
  vi.stubEnv("THINKWORK_API_SECRET", "test-secret");
  vi.stubEnv("WORKSPACE_BUCKET", "workspace-bucket-test");
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
  mocks.readThreadLastRender.mockResolvedValue(MARKER);
  mocks.writeThreadLastRender.mockResolvedValue(undefined);
  mocks.computeRoutingSignature.mockResolvedValue("sig-1");
  mocks.evaluateRenderSkip.mockResolvedValue({
    skip: true,
    reason: "fresh",
    marker: MARKER,
  });
  mocks.rendererResponse = {
    ok: true,
    statusCode: 200,
    renderedPrefix: "tenants/acme/threads/thread-1/",
    cacheStatus: "miss",
    sourcePrefixes: ["tenants/acme/agents/agent-1/"],
  };
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
    capabilityFolderDispatch: false,
  });
});

function rendererInvokes() {
  return mocks.lambdaInvokes.filter((c) => c.FunctionName === "renderer-fn");
}

function dispatchedPayload(): Record<string, unknown> {
  const dispatch = mocks.lambdaInvokes.find(
    (c) => c.FunctionName === "pi-runtime-fn",
  );
  expect(dispatch, "runtime dispatch invoke").toBeTruthy();
  const outer = JSON.parse(new TextDecoder().decode(dispatch!.Payload));
  return JSON.parse(outer.body);
}

describe("chat-agent-invoke — render-skip wiring (U2)", () => {
  it("skip verdict: renderer never invoked, carried prefix dispatched", async () => {
    const { handler } = await import("./chat-agent-invoke.js");
    await handler(BASE_EVENT);
    expect(rendererInvokes()).toHaveLength(0);
    const payload = dispatchedPayload();
    expect(payload.rendered_workspace_prefix).toBe(
      "tenants/acme/threads/thread-1/",
    );
    // No fresh render happened, so the marker must not be rewritten.
    expect(mocks.writeThreadLastRender).not.toHaveBeenCalled();
  });

  it("declined verdict: renders exactly as today and refreshes the marker", async () => {
    mocks.evaluateRenderSkip.mockResolvedValue({
      skip: false,
      reason: "sources_changed",
    });
    const { handler } = await import("./chat-agent-invoke.js");
    await handler(BASE_EVENT);
    expect(rendererInvokes()).toHaveLength(1);
    expect(mocks.writeThreadLastRender).toHaveBeenCalledTimes(1);
    const marker = mocks.writeThreadLastRender.mock.calls[0][0].marker;
    expect(marker.renderedPrefix).toBe("tenants/acme/threads/thread-1/");
    expect(marker.sourcePrefixes).toEqual(["tenants/acme/agents/agent-1/"]);
    expect(typeof marker.configFingerprint).toBe("string");
  });

  it("corrupt marker (empty prefix): full render, never a stale/empty prefix", async () => {
    mocks.readThreadLastRender.mockResolvedValue({
      ...MARKER,
      renderedPrefix: "",
    });
    const { handler } = await import("./chat-agent-invoke.js");
    await handler(BASE_EVENT);
    expect(mocks.evaluateRenderSkip).not.toHaveBeenCalled();
    expect(rendererInvokes()).toHaveLength(1);
    const payload = dispatchedPayload();
    expect(payload.rendered_workspace_prefix).toBe(
      "tenants/acme/threads/thread-1/",
    );
  });

  it("no marker: renders and seeds the first marker", async () => {
    mocks.readThreadLastRender.mockResolvedValue(null);
    const { handler } = await import("./chat-agent-invoke.js");
    await handler(BASE_EVENT);
    expect(mocks.evaluateRenderSkip).not.toHaveBeenCalled();
    expect(rendererInvokes()).toHaveLength(1);
    expect(mocks.writeThreadLastRender).toHaveBeenCalledTimes(1);
  });

  it("renderer without sourcePrefixes: no marker written (skip stays disabled)", async () => {
    mocks.readThreadLastRender.mockResolvedValue(null);
    mocks.rendererResponse = {
      ok: true,
      statusCode: 200,
      renderedPrefix: "tenants/acme/threads/thread-1/",
      cacheStatus: "miss",
    };
    const { handler } = await import("./chat-agent-invoke.js");
    await handler(BASE_EVENT);
    expect(rendererInvokes()).toHaveLength(1);
    expect(mocks.writeThreadLastRender).not.toHaveBeenCalled();
  });
});
