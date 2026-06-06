import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSets: [] as unknown[],
  updateReturning: [] as Array<unknown[]>,
  reconcileChangedFiles: vi.fn(),
  recordCostEvents: vi.fn(),
  checkBudgetAndPause: vi.fn(),
  notifyCostRecorded: vi.fn(),
  notifyThreadTurnUpdate: vi.fn(),
  notifyThreadUpdate: vi.fn(),
  insertAssistantMessage: vi.fn(),
  notifyNewMessage: vi.fn(),
  markComputerTaskFailedFromFinalize: vi.fn(),
  appendThreadTurnEvent: vi.fn(),
  sendTurnCompletedPush: vi.fn(),
  sendThreadReplyEmail: vi.fn(),
  refreshCustomerOnboardingGoalFolderSafely: vi.fn(),
  recordGuardrailBlock: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: () => ({
      set: (value: unknown) => {
        mocks.updateSets.push(value);
        return {
          where: () => ({
            returning: async () => mocks.updateReturning.shift() ?? [],
          }),
        };
      },
    }),
  }),
}));

vi.mock("./reconcile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reconcile.js")>();
  return {
    ...actual,
    reconcileChangedFiles: mocks.reconcileChangedFiles,
  };
});

vi.mock("../cost-recording.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cost-recording.js")>();
  return {
    ...actual,
    recordCostEvents: mocks.recordCostEvents,
    checkBudgetAndPause: mocks.checkBudgetAndPause,
    notifyCostRecorded: mocks.notifyCostRecorded,
  };
});

vi.mock("../thread-turn-events.js", () => ({
  appendThreadTurnEvent: mocks.appendThreadTurnEvent,
  drizzleThreadTurnEventStore: () => ({}),
}));

vi.mock("./notify.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./notify.js")>();
  return {
    ...actual,
    insertAssistantMessage: mocks.insertAssistantMessage,
    markComputerTaskFailedFromFinalize:
      mocks.markComputerTaskFailedFromFinalize,
    notifyNewMessage: mocks.notifyNewMessage,
    notifyThreadTurnUpdate: mocks.notifyThreadTurnUpdate,
  };
});

vi.mock("../../graphql/notify.js", () => ({
  notifyThreadUpdate: mocks.notifyThreadUpdate,
}));

vi.mock("../push-notifications.js", () => ({
  sendTurnCompletedPush: mocks.sendTurnCompletedPush,
}));

vi.mock("../email/thread-reply.js", () => ({
  sendThreadReplyEmail: mocks.sendThreadReplyEmail,
}));

vi.mock("../spaces/customer-onboarding-goal-md.js", () => ({
  refreshCustomerOnboardingGoalFolderSafely:
    mocks.refreshCustomerOnboardingGoalFolderSafely,
}));

vi.mock("./record-guardrail-block.js", () => ({
  recordGuardrailBlock: mocks.recordGuardrailBlock,
}));

import {
  capturedSystemPromptFromFinalizePayload,
  collectModelRoutedToolCalls,
  diagnosticsFromFinalizePayload,
  diagnosticsWithWorkspaceReconcile,
  enrichToolInvocationsWithModelRouting,
  isHiddenDesktopDelegation,
  processFinalize,
  toFinalizeResponse,
} from "./process-finalize";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TURN_ID = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateSets = [];
  mocks.updateReturning = [
    [
      {
        id: TURN_ID,
        runtimeType: "pi",
        contextSnapshot: null,
      },
    ],
  ];
  mocks.reconcileChangedFiles.mockReset();
  mocks.reconcileChangedFiles.mockResolvedValue({
    status: "no_changes",
    files: [],
  });
  mocks.recordCostEvents.mockResolvedValue({ totalUsd: 1.23 });
  mocks.checkBudgetAndPause.mockResolvedValue(undefined);
  mocks.notifyCostRecorded.mockResolvedValue(undefined);
  mocks.notifyThreadTurnUpdate.mockResolvedValue(undefined);
  mocks.notifyThreadUpdate.mockResolvedValue(undefined);
  mocks.insertAssistantMessage.mockResolvedValue({ id: "msg-1" });
  mocks.notifyNewMessage.mockResolvedValue(undefined);
  mocks.markComputerTaskFailedFromFinalize.mockResolvedValue(undefined);
  mocks.appendThreadTurnEvent.mockResolvedValue({ id: 1, seq: 0 });
  mocks.sendTurnCompletedPush.mockResolvedValue(undefined);
  mocks.sendThreadReplyEmail.mockResolvedValue(undefined);
  mocks.refreshCustomerOnboardingGoalFolderSafely.mockResolvedValue(undefined);
  mocks.recordGuardrailBlock.mockResolvedValue(undefined);
});

describe("capturedSystemPromptFromFinalizePayload", () => {
  it("uses the top-level composed prompt from runtime finalize payloads", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: "Current date: Monday",
        response: {},
      }),
    ).toBe("Current date: Monday");
  });

  it("falls back to a nested response prompt for older callback shapes", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: null,
        response: { composed_system_prompt: "Runtime Tool Policy" },
      }),
    ).toBe("Runtime Tool Policy");
  });

  it("ignores blank prompt values", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: "   ",
        response: { composed_system_prompt: "" },
      }),
    ).toBeNull();
  });
});

describe("diagnosticsFromFinalizePayload", () => {
  it("prefers usage diagnostics because they are persisted on usage_json", () => {
    expect(
      diagnosticsFromFinalizePayload({
        usage: { diagnostics: { local_pi_timings_ms: { total_ms: 123 } } },
        response: { diagnostics: { local_pi_timings_ms: { total_ms: 999 } } },
      }),
    ).toEqual({ local_pi_timings_ms: { total_ms: 123 } });
  });

  it("falls back to response diagnostics for older runtime payloads", () => {
    expect(
      diagnosticsFromFinalizePayload({
        response: { diagnostics: { local_pi_timings_ms: { total_ms: 456 } } },
      }),
    ).toEqual({ local_pi_timings_ms: { total_ms: 456 } });
  });
});

describe("diagnosticsWithWorkspaceReconcile", () => {
  it("adds reconcile timing and file counts to workspace diagnostics", () => {
    expect(
      diagnosticsWithWorkspaceReconcile(
        {
          agentcore_phases: [
            {
              phase: "runtime.workspace_bootstrap",
              status: "completed",
              duration_ms: 42,
            },
          ],
          workspace_diagnostics: {
            workspace_sync_ms: 42,
            changed_files: 1,
          },
        },
        {
          status: "partial_success",
          files: [
            {
              path: "AGENTS.md",
              op: "modify",
              owner: "agent",
              status: "written",
              sourceKey: "tenants/acme/agents/marco/AGENTS.md",
              etag: '"new"',
            },
            {
              path: "Thread/PROGRESS.md",
              op: "modify",
              owner: "status",
              status: "rejected",
              code: "read_only_status_file",
              message: "generated",
            },
            {
              path: "User/memory/stale.md",
              op: "modify",
              owner: "user",
              status: "rejected",
              code: "base_etag_mismatch",
              message: "stale",
            },
          ],
        },
        17,
      ),
    ).toMatchObject({
      agentcore_phases: [
        {
          phase: "runtime.workspace_bootstrap",
          status: "completed",
          duration_ms: 42,
        },
      ],
      workspace_diagnostics: {
        workspace_sync_ms: 42,
        reconcile_writeback_ms: 17,
        reconcile_status: "partial_success",
        changed_files: 3,
        persisted_files: 1,
        rejected_files: 2,
        conflicted_files: 1,
      },
    });
  });
});

describe("isHiddenDesktopDelegation", () => {
  it("detects hidden managed delegation turn contexts", () => {
    expect(
      isHiddenDesktopDelegation({
        desktop_managed_delegation: {
          visibility: "hidden",
        },
      }),
    ).toBe(true);
    expect(
      isHiddenDesktopDelegation({
        desktop_managed_delegation: {
          visibility: "visible",
        },
      }),
    ).toBe(false);
  });
});

describe("model routed tool evidence helpers", () => {
  it("collects routed model usage from tool invocation metadata", () => {
    expect(
      collectModelRoutedToolCalls({
        tool_invocations: [
          {
            id: "tool-1",
            tool_name: "workspace_skill",
            model_routing: {
              match: { slug: "research" },
              model: "anthropic.claude-haiku",
              status: "completed",
              inputTokens: 42,
              outputTokens: 7,
              cachedReadTokens: 3,
              durationMs: 123,
              ruleSource: { owner: "user", path: "User/TOOLS.md" },
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        toolCallId: "tool-1",
        toolName: "workspace_skill",
        model: "anthropic.claude-haiku",
        inputTokens: 42,
        outputTokens: 7,
        cachedReadTokens: 3,
        ruleSource: { owner: "user", path: "User/TOOLS.md" },
      }),
    ]);
  });

  it("enriches tool invocations with flat model and token fields", () => {
    expect(
      enrichToolInvocationsWithModelRouting([
        {
          id: "tool-1",
          tool_name: "workspace_skill",
          model_routing: {
            match: { slug: "research" },
            model: "anthropic.claude-haiku",
            inputTokens: 42,
            outputTokens: 7,
            cachedReadTokens: 3,
          },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        model: "anthropic.claude-haiku",
        input_tokens: 42,
        output_tokens: 7,
        cached_read_tokens: 3,
        model_routing_status: "completed",
      }),
    ]);
  });
});

describe("processFinalize reconcile seam", () => {
  it("passes the runtime cost owner user id to cost recording and subscriptions", async () => {
    mocks.updateReturning = [
      [
        {
          id: TURN_ID,
          runtimeType: "pi",
          contextSnapshot: {
            desktop_managed_delegation: { visibility: "hidden" },
          },
        },
      ],
    ];

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        cost_owner_user_id: "55555555-5555-5555-5555-555555555555",
        duration_ms: 25,
        status: "completed",
        response: { content: "done" },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 100,
          output_tokens: 10,
        },
      }),
    ).resolves.toMatchObject({ finalized: true, messageId: null });

    expect(mocks.recordCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        userId: "55555555-5555-5555-5555-555555555555",
      }),
    );
    expect(mocks.checkBudgetAndPause).toHaveBeenCalledWith(
      TENANT_ID,
      AGENT_ID,
      "55555555-5555-5555-5555-555555555555",
    );
    expect(mocks.notifyCostRecorded).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        userId: "55555555-5555-5555-5555-555555555555",
        amountUsd: 1.23,
      }),
    );
  });

  it("records child LLM cost and durable event evidence for routed tool models", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        trace_id: "trace-1",
        cost_owner_user_id: "55555555-5555-5555-5555-555555555555",
        duration_ms: 25,
        status: "completed",
        response: {
          content: "done",
          model_routed_tool_calls: [
            {
              toolCallId: "tool-1",
              toolName: "workspace_skill",
              match: { slug: "research" },
              model: "anthropic.claude-haiku",
              status: "completed",
              inputTokens: 100,
              outputTokens: 20,
              cachedReadTokens: 5,
              durationMs: 250,
              ruleSource: { owner: "user", path: "User/TOOLS.md" },
            },
          ],
          tool_invocations: [
            {
              id: "tool-1",
              tool_name: "workspace_skill",
              model_routing: {
                match: { slug: "research" },
                model: "anthropic.claude-haiku",
                status: "completed",
                inputTokens: 100,
                outputTokens: 20,
                cachedReadTokens: 5,
                durationMs: 250,
                ruleSource: { owner: "user", path: "User/TOOLS.md" },
              },
            },
          ],
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 1000,
          output_tokens: 200,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    expect(mocks.recordCostEvents).toHaveBeenCalledTimes(2);
    expect(mocks.recordCostEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        requestId: `${TURN_ID}:tool:tool-1:model`,
        model: "anthropic.claude-haiku",
        inputTokens: 100,
        outputTokens: 20,
        cachedReadTokens: 5,
        source: "pi_tool_model_route",
        recordCompute: false,
        metadata: expect.objectContaining({
          parent_request_id: TURN_ID,
          tool_call_id: "tool-1",
          tool_name: "workspace_skill",
          model_routing_status: "completed",
          match: { slug: "research" },
        }),
      }),
    );
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        runId: TURN_ID,
        eventType: "model_routed_tool_call",
        payload: expect.objectContaining({
          tool_call_id: "tool-1",
          model: "anthropic.claude-haiku",
          input_tokens: 100,
          output_tokens: 20,
        }),
      }),
    );
    expect(mocks.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          usage_json: expect.objectContaining({
            model_routed_tool_calls: [
              expect.objectContaining({
                toolCallId: "tool-1",
                model: "anthropic.claude-haiku",
              }),
            ],
            tool_invocations: [
              expect.objectContaining({
                model: "anthropic.claude-haiku",
                input_tokens: 100,
                output_tokens: 20,
              }),
            ],
          }),
        }),
      ]),
    );
  });

  it("records rejected model routes as events without child LLM cost rows", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: {
          content: "done",
          model_routed_tool_calls: [
            {
              toolCallId: "tool-1",
              toolName: "workspace_skill",
              match: { slug: "research" },
              model: "not-approved",
              status: "rejected",
              error: "not approved",
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    expect(mocks.recordCostEvents).toHaveBeenCalledTimes(1);
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        level: "error",
        payload: expect.objectContaining({
          status: "rejected",
          error: "not approved",
          model: "not-approved",
        }),
      }),
    );
  });

  it("re-enters reconcile on retry when the U4 non-empty diff stub throws", async () => {
    mocks.updateReturning = [
      [
        {
          id: TURN_ID,
          runtimeType: "pi",
          contextSnapshot: null,
        },
      ],
      [
        {
          id: TURN_ID,
          runtimeType: "pi",
          contextSnapshot: null,
        },
      ],
    ];
    mocks.reconcileChangedFiles.mockRejectedValue(new Error("stub throws"));
    const payload = {
      thread_turn_id: TURN_ID,
      tenant_id: TENANT_ID,
      agent_id: AGENT_ID,
      thread_id: THREAD_ID,
      duration_ms: 1,
      status: "completed" as const,
      response: { content: "done" },
      changed_files: [
        { path: "docs/new.md", op: "create" as const, content: "# New\n" },
      ],
    };

    await expect(processFinalize(payload)).rejects.toThrow("stub throws");
    await expect(processFinalize(payload)).rejects.toThrow("stub throws");

    expect(mocks.reconcileChangedFiles).toHaveBeenCalledTimes(2);
    expect(mocks.updateSets[0]).not.toHaveProperty("finalized_at");
    expect(mocks.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ context_snapshot: expect.anything() }),
      ]),
    );
  });
});

describe("toFinalizeResponse", () => {
  it("surfaces reconcile status on non-idempotent finalize responses", () => {
    expect(
      toFinalizeResponse({
        finalized: true,
        messageId: "msg-1",
        reconcile: {
          status: "complete",
          files: [
            {
              path: "memory/preferences.md",
              op: "modify",
              owner: "user",
              status: "written",
              sourceKey: "tenants/acme/users/eric/memory/preferences.md",
              etag: '"new"',
            },
          ],
        },
      }),
    ).toEqual({
      ok: true,
      idempotent: false,
      messageId: "msg-1",
      reconcile: {
        status: "complete",
        files: [
          {
            path: "memory/preferences.md",
            op: "modify",
            owner: "user",
            status: "written",
            sourceKey: "tenants/acme/users/eric/memory/preferences.md",
            etag: '"new"',
          },
        ],
      },
    });
  });
});
