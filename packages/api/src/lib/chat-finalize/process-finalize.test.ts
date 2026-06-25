import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSets: [] as unknown[],
  updateReturning: [] as Array<unknown[]>,
  selectRows: [] as Array<Record<string, unknown>>,
  reconcileChangedFiles: vi.fn(),
  recordCostEvents: vi.fn(),
  recordTraceEvidence: vi.fn(),
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
  promoteNextDeferredWakeup: vi.fn(),
  mergeWorkspaceProjectionReconcileSummary: vi.fn(),
  finalizeN8nAgentStepRun: vi.fn(),
  projectAgentLoopFinalize: vi.fn(),
  autoSubmitSkillCreatorDraft: vi.fn(),
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
    // Used only by the asking-turn pending-question preview lookup.
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => mocks.selectRows,
          }),
        }),
      }),
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

vi.mock("../trace-ledger/record-trace-evidence.js", () => ({
  recordTraceEvidence: mocks.recordTraceEvidence,
}));

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

vi.mock("../wakeup-defer.js", () => ({
  promoteNextDeferredWakeup: mocks.promoteNextDeferredWakeup,
}));

vi.mock("../n8n-agent-step/finalize.js", () => ({
  finalizeN8nAgentStepRun: mocks.finalizeN8nAgentStepRun,
}));

vi.mock("../agent-loops/finalize-projection.js", () => ({
  projectAgentLoopFinalize: mocks.projectAgentLoopFinalize,
}));

vi.mock("../skill-creator/auto-submit-draft.js", () => ({
  autoSubmitSkillCreatorDraft: mocks.autoSubmitSkillCreatorDraft,
}));

vi.mock("../workspace-projection-snapshot.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../workspace-projection-snapshot.js")
    >();
  return {
    ...actual,
    mergeWorkspaceProjectionReconcileSummary:
      mocks.mergeWorkspaceProjectionReconcileSummary,
  };
});

import {
  capturedSystemPromptFromFinalizePayload,
  collectAgentProfileRuns,
  collectModelRoutedToolCalls,
  diagnosticsFromFinalizePayload,
  diagnosticsWithWorkspaceReconcile,
  enrichToolInvocationsWithModelRouting,
  goalRunProjectionFromFinalizePayload,
  isHiddenDesktopDelegation,
  processFinalize,
  toFinalizeResponse,
  turnAskedUserQuestion,
} from "./process-finalize";
import { createTaskReviewGenUIFixture } from "@thinkwork/genui";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TURN_ID = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateSets = [];
  mocks.selectRows = [];
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
  mocks.recordCostEvents.mockResolvedValue({
    totalUsd: 1.23,
    llmUsd: 1.23,
    computeUsd: 0,
  });
  mocks.recordTraceEvidence.mockReset();
  mocks.recordTraceEvidence.mockResolvedValue({
    traceRunId: "trace-run-1",
    traceEventIds: {},
    costEventIds: [],
  });
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
  mocks.promoteNextDeferredWakeup.mockResolvedValue(null);
  mocks.mergeWorkspaceProjectionReconcileSummary.mockReset();
  mocks.mergeWorkspaceProjectionReconcileSummary.mockResolvedValue(undefined);
  mocks.finalizeN8nAgentStepRun.mockReset();
  mocks.finalizeN8nAgentStepRun.mockResolvedValue({
    action: "no_run",
    runId: null,
    status: null,
  });
  mocks.projectAgentLoopFinalize.mockReset();
  mocks.projectAgentLoopFinalize.mockResolvedValue({
    status: "skipped",
    reason: "not_agent_loop_turn",
  });
  mocks.autoSubmitSkillCreatorDraft.mockReset();
  mocks.autoSubmitSkillCreatorDraft.mockResolvedValue({
    status: "skipped",
    reason: "not_skill_creator_turn",
  });
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

describe("goalRunProjectionFromFinalizePayload", () => {
  it("normalizes bounded Pi goal-run evidence", () => {
    const goalRun = goalRunProjectionFromFinalizePayload({
      response: {
        goal_run: {
          source: "pi_goal",
          action: "start",
          goal_id: "goal-1",
          objective: "Ship the reporting workflow",
          status: "budget_limited",
          token_budget: 125000,
          tokens_used: 124532,
          completion_summary: "Implemented most of the workflow.",
          verification_notes: ["Focused tests passed."],
          updated_at: "2026-06-21T22:00:00.000Z",
        },
      },
    });

    expect(goalRun).toEqual(
      expect.objectContaining({
        source: "pi_goal",
        status: "budget_limited",
        action: "start",
        goal_id: "goal-1",
        objective: "Ship the reporting workflow",
        token_budget: 125000,
        tokens_used: 124532,
        completion_summary: "Implemented most of the workflow.",
        verification_notes: ["Focused tests passed."],
        resume_eligible: true,
      }),
    );
  });

  it("falls back to bounded debug evidence for malformed runtime payloads", () => {
    const goalRun = goalRunProjectionFromFinalizePayload({
      response: { goal_run: "not-json" },
    });

    expect(goalRun).toEqual({
      source: "pi_goal",
      status: "unknown",
      summary: "Malformed goal-run evidence",
      resume_eligible: false,
      debug: {
        error: "malformed_goal_run",
        preview: '"not-json"',
      },
    });
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
  it("collects Agent Profile runs from top-level, response, and tool result evidence", () => {
    expect(
      collectAgentProfileRuns({
        agent_profile_runs: [
          {
            profileRunId: "run-top",
            profileId: "profile-research",
            profileSlug: "research",
            profileName: "Research",
            model: "anthropic.claude-haiku",
            status: "completed",
            inputTokens: 10,
            outputTokens: 5,
            laneKey: "profile:research",
          },
        ],
        response: {
          agent_profile_runs: [
            {
              profileRunId: "run-response",
              profileId: "profile-analyst",
              profileSlug: "analyst",
              profileName: "Analyst",
              model: "moonshotai.kimi-k2.5",
              status: "failed",
              error: "bad data",
            },
          ],
          tool_invocations: [
            {
              id: "delegate-1",
              result: {
                agent_profile_run: {
                  profileRunId: "run-tool",
                  profileId: "profile-coding",
                  profileSlug: "coding",
                  profileName: "Coding",
                  model: "anthropic.claude-sonnet",
                  status: "completed",
                  toolInvocations: [{ id: "tool-1", tool_name: "read" }],
                },
              },
            },
          ],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        profileRunId: "run-top",
        profileSlug: "research",
        laneKey: "profile:research",
      }),
      expect.objectContaining({
        profileRunId: "run-response",
        profileSlug: "analyst",
        status: "failed",
        error: "bad data",
      }),
      expect.objectContaining({
        profileRunId: "run-tool",
        profileSlug: "coding",
        laneKey: "profile:coding",
        toolInvocations: [expect.objectContaining({ tool_name: "read" })],
      }),
    ]);
  });

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
  it("offers reconciled /skill-creator turns to the draft registration bridge", async () => {
    const reconcileReport = {
      status: "complete" as const,
      files: [
        {
          path: "skills/codex-e2e/SKILL.md",
          op: "create" as const,
          owner: "agent" as const,
          status: "written" as const,
          sourceKey: "tenants/acme/agents/default/skills/codex-e2e/SKILL.md",
          etag: "etag-1",
        },
      ],
    };
    mocks.reconcileChangedFiles.mockResolvedValueOnce(reconcileReport);
    mocks.autoSubmitSkillCreatorDraft.mockResolvedValueOnce({
      status: "submitted",
      draftId: "draft-1",
      slug: "codex-e2e",
      fileCount: 1,
      currentContentHash: "sha256:test",
    });

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        cost_owner_user_id: "55555555-5555-5555-5555-555555555555",
        user_message:
          "/skill-creator create codex-e2e and submit it for review",
        duration_ms: 25,
        status: "completed",
        changed_files: [
          {
            path: "skills/codex-e2e/SKILL.md",
            op: "create",
            content: "---\nname: codex-e2e\ndescription: Test.\n---\n",
          },
        ],
        skill_creator_command: {
          type: "skill_creator",
          source: "slash_command",
          command: "/skill-creator",
        },
        response: { content: "draft created" },
      }),
    ).resolves.toMatchObject({ finalized: true });

    expect(mocks.autoSubmitSkillCreatorDraft).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      threadTurnId: TURN_ID,
      requesterUserId: "55555555-5555-5555-5555-555555555555",
      userMessage: "/skill-creator create codex-e2e and submit it for review",
      skillCreatorCommand: {
        type: "skill_creator",
        source: "slash_command",
        command: "/skill-creator",
      },
      reconcileReport,
    });
    expect(mocks.insertAssistantMessage).toHaveBeenCalledWith(
      THREAD_ID,
      TENANT_ID,
      AGENT_ID,
      "draft created",
      [],
      undefined,
      {
        skillDraft: {
          id: "draft-1",
          slug: "codex-e2e",
          status: "submitted",
          source: "skill_creator",
          sourceThreadId: THREAD_ID,
          sourceTurnId: TURN_ID,
          fileCount: 1,
          currentContentHash: "sha256:test",
        },
      },
    );
    expect(mocks.updateSets).toContainEqual({ source_message_id: "msg-1" });
  });

  it("falls back to the latest user message sender when the finalize payload has no cost owner", async () => {
    const requesterUserId = "77777777-7777-7777-7777-777777777777";
    const reconcileReport = {
      status: "complete" as const,
      files: [
        {
          path: "skills/codex-e2e/SKILL.md",
          op: "create" as const,
          owner: "agent" as const,
          status: "written" as const,
          sourceKey: "tenants/acme/agents/default/skills/codex-e2e/SKILL.md",
          etag: "etag-1",
        },
      ],
    };
    mocks.selectRows = [{ senderId: requesterUserId }];
    mocks.reconcileChangedFiles.mockResolvedValueOnce(reconcileReport);
    mocks.autoSubmitSkillCreatorDraft.mockResolvedValueOnce({
      status: "submitted",
      draftId: "draft-1",
      slug: "codex-e2e",
      fileCount: 1,
      currentContentHash: "sha256:test",
    });

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        user_message:
          "/skill-creator create codex-e2e and submit it for review",
        duration_ms: 25,
        status: "completed",
        skill_creator_command: {
          type: "skill_creator",
          source: "slash_command",
          command: "/skill-creator",
        },
        response: { content: "draft created" },
      }),
    ).resolves.toMatchObject({ finalized: true });

    expect(mocks.autoSubmitSkillCreatorDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId,
        skillCreatorCommand: {
          type: "skill_creator",
          source: "slash_command",
          command: "/skill-creator",
        },
      }),
    );
  });

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

  it("dual-writes normalized finalize evidence to the trace ledger", async () => {
    mocks.reconcileChangedFiles.mockResolvedValueOnce({
      status: "partial_success",
      files: [
        {
          path: "README.md",
          op: "modify",
          owner: "agent",
          status: "written",
          sourceKey: "tenants/acme/README.md",
          etag: "etag-1",
        },
      ],
    });

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        trace_id: "trace-1",
        cost_owner_user_id: "55555555-5555-5555-5555-555555555555",
        runtime_type: "pi",
        duration_ms: 25,
        status: "completed",
        response: {
          content: "done",
          diagnostics: {
            agentcore_phases: [
              {
                phase: "runtime.workspace_bootstrap",
                status: "completed",
                duration_ms: 42,
              },
            ],
          },
          tool_invocations: [
            {
              id: "tool-1",
              tool_name: "web_search",
              input_preview: '{"query":"trace ledger"}',
              output_preview: "Search results",
            },
          ],
          model_routed_tool_calls: [
            {
              toolCallId: "tool-1",
              toolName: "web_search",
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
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 1000,
          output_tokens: 200,
          cached_read_tokens: 15,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    expect(mocks.recordTraceEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        userId: "55555555-5555-5555-5555-555555555555",
        threadId: THREAD_ID,
        threadTurnId: TURN_ID,
        traceId: "trace-1",
        runtimeType: "pi",
        status: "completed",
        usage: {
          model: "moonshotai.kimi-k2.5",
          inputTokens: 1000,
          outputTokens: 200,
          cachedReadTokens: 15,
          costUsd: 1.23,
        },
        diagnostics: expect.objectContaining({
          agentcore_phases: [
            {
              phase: "runtime.workspace_bootstrap",
              status: "completed",
              duration_ms: 42,
            },
          ],
          workspace_diagnostics: expect.objectContaining({
            reconcile_status: "partial_success",
            changed_files: 1,
            persisted_files: 1,
          }),
        }),
        toolInvocations: [
          expect.objectContaining({
            id: "tool-1",
            tool_name: "web_search",
          }),
        ],
        modelRoutedToolCalls: [
          expect.objectContaining({
            toolCallId: "tool-1",
            model: "anthropic.claude-haiku",
          }),
        ],
      }),
    );
  });

  it("keeps existing finalize projections when trace ledger writing fails", async () => {
    mocks.recordTraceEvidence.mockRejectedValueOnce(
      new Error("ledger unavailable"),
    );

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: { content: "Still finalize the turn." },
      }),
    ).resolves.toMatchObject({ finalized: true });

    expect(mocks.insertAssistantMessage).toHaveBeenCalledWith(
      THREAD_ID,
      TENANT_ID,
      AGENT_ID,
      "Still finalize the turn.",
      [],
      undefined,
      undefined,
    );
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "trace_ledger_write_failed",
        level: "warn",
        payload: expect.objectContaining({
          error: "ledger unavailable",
        }),
      }),
    );
  });

  it("persists bounded goal-run evidence on completed turns", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: {
          content: "Goal paused at the tenant budget.",
          goal_run: {
            action: "start",
            goal_id: "goal-1",
            objective: "Complete the rollout checklist",
            status: "budget_limited",
            token_budget: 125000,
            tokens_used: 125001,
            completion_summary: "Implemented two of three rollout items.",
            verification_notes: ["API tests passed."],
          },
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 100,
          output_tokens: 10,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    const succeededUpdate = mocks.updateSets.find((value: any) =>
      Boolean(value?.result_json?.goal_run),
    ) as any;
    expect(succeededUpdate.result_json.goal_run).toMatchObject({
      source: "pi_goal",
      status: "budget_limited",
      goal_id: "goal-1",
      objective: "Complete the rollout checklist",
      token_budget: 125000,
      tokens_used: 125001,
      completion_summary: "Implemented two of three rollout items.",
      verification_notes: ["API tests passed."],
      resume_eligible: true,
    });
    expect(succeededUpdate.usage_json.goal_run).toEqual(
      succeededUpdate.result_json.goal_run,
    );
  });

  it("projects AgentLoop finalization from normalized goal-run evidence", async () => {
    mocks.updateReturning = [
      [
        {
          id: TURN_ID,
          runtimeType: "pi",
          contextSnapshot: {
            agentLoop: {
              runId: "run-1",
              iterationId: "iteration-1",
            },
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
        duration_ms: 25,
        status: "completed",
        response: {
          content: "Goal complete.",
          goal_run: {
            goal_id: "goal-1",
            status: "completed",
            completion_summary: "All criteria passed.",
          },
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 100,
          output_tokens: 10,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    expect(mocks.projectAgentLoopFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        threadTurnId: TURN_ID,
        contextSnapshot: {
          agentLoop: {
            runId: "run-1",
            iterationId: "iteration-1",
          },
        },
        goalRun: expect.objectContaining({
          source: "pi_goal",
          status: "completed",
          completion_summary: "All criteria passed.",
        }),
        responseText: "Goal complete.",
        turnStatus: "completed",
      }),
    );
  });

  it("does not fail normal finalization when AgentLoop projection fails", async () => {
    mocks.projectAgentLoopFinalize.mockRejectedValueOnce(
      new Error("projection unavailable"),
    );

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: {
          content: "Still finalize the turn.",
        },
      }),
    ).resolves.toMatchObject({ finalized: true });
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
                costUsd: 1.23,
              }),
            ],
            tool_invocations: [
              expect.objectContaining({
                model: "anthropic.claude-haiku",
                input_tokens: 100,
                output_tokens: 20,
                cost_usd: 1.23,
                model_routing: expect.objectContaining({
                  costUsd: 1.23,
                  cost_usd: 1.23,
                }),
              }),
            ],
          }),
        }),
      ]),
    );
  });

  it("records Agent Profile run cost, event, and usage evidence", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        trace_id: "trace-profile",
        cost_owner_user_id: "55555555-5555-5555-5555-555555555555",
        duration_ms: 50,
        status: "completed",
        response: {
          content: "Parent summary",
          agent_profile_runs: [
            {
              profileRunId: "profile-run-1",
              profileId: "profile-research",
              profileSlug: "research",
              profileName: "Research",
              model: "anthropic.claude-haiku",
              status: "completed",
              inputTokens: 120,
              outputTokens: 40,
              cachedReadTokens: 8,
              durationMs: 900,
              handoffSummary: "Research handoff",
              laneKey: "profile:research",
              loopEvidence: {
                loopId: "loop-research-1",
                ownerType: "profile",
                ownerSlug: "research",
                iterations: [
                  {
                    index: 0,
                    phase: "handoff",
                    status: "completed",
                    verdict: "pass",
                  },
                ],
              },
              toolInvocations: [
                {
                  id: "child-tool-1",
                  tool_name: "web_search",
                  input_preview: '{"query":"Stripe CEO"}',
                },
              ],
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
        requestId: `${TURN_ID}:profile:profile-run-1:model`,
        model: "anthropic.claude-haiku",
        inputTokens: 120,
        outputTokens: 40,
        cachedReadTokens: 8,
        durationMs: 900,
        source: "pi_agent_profile",
        recordCompute: false,
        metadata: expect.objectContaining({
          parent_request_id: TURN_ID,
          profile_run_id: "profile-run-1",
          profile_id: "profile-research",
          profile_slug: "research",
          profile_name: "Research",
          lane_key: "profile:research",
          profile_status: "completed",
          loop_id: "loop-research-1",
          loop_owner_type: "profile",
          loop_owner_slug: "research",
          loop_iteration_index: 0,
          loop_phase: "handoff",
          loop_status: "completed",
          loop_verdict: "pass",
          loop_evidence: expect.objectContaining({
            loopId: "loop-research-1",
          }),
        }),
      }),
    );
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        runId: TURN_ID,
        eventType: "agent_profile_run",
        message: "Agent Profile Research completed on anthropic.claude-haiku",
        payload: expect.objectContaining({
          profile_run_id: "profile-run-1",
          profile_slug: "research",
          model: "anthropic.claude-haiku",
          input_tokens: 120,
          output_tokens: 40,
          cost_usd: 1.23,
          status: "completed",
          lane_key: "profile:research",
          handoff_summary: "Research handoff",
          loop_evidence: expect.objectContaining({
            loopId: "loop-research-1",
            ownerType: "profile",
            ownerSlug: "research",
          }),
          tool_invocations: [
            expect.objectContaining({ tool_name: "web_search" }),
          ],
        }),
      }),
    );
    const succeededUpdate = mocks.updateSets.find((value: any) =>
      Boolean(value?.usage_json?.agent_profile_runs),
    ) as any;
    expect(succeededUpdate.usage_json.agent_profile_runs).toEqual([
      expect.objectContaining({
        profileRunId: "profile-run-1",
        profileSlug: "research",
        model: "anthropic.claude-haiku",
        inputTokens: 120,
        outputTokens: 40,
        costUsd: 1.23,
        loopEvidence: expect.objectContaining({
          loopId: "loop-research-1",
          ownerType: "profile",
          ownerSlug: "research",
        }),
        toolInvocations: [expect.objectContaining({ tool_name: "web_search" })],
      }),
    ]);
    expect(succeededUpdate.usage_json).toMatchObject({
      input_tokens: 1120,
      output_tokens: 240,
      cached_read_tokens: 8,
      cost_usd: 2.46,
      parent_usage: {
        model: "moonshotai.kimi-k2.5",
        input_tokens: 1000,
        output_tokens: 200,
        cached_read_tokens: 0,
        cost_usd: 1.23,
      },
    });
  });

  it("aggregates Research, Reviewer, and retry profile tokens into the turn summary", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        trace_id: "trace-loop",
        duration_ms: 50,
        status: "completed",
        response: {
          content: "Parent final answer",
          agent_profile_runs: [
            {
              profileRunId: "research-1",
              profileId: "profile-research",
              profileSlug: "research",
              profileName: "Research",
              model: "anthropic.claude-haiku",
              status: "completed",
              inputTokens: 100,
              outputTokens: 20,
              durationMs: 900,
              loopEvidence: {
                loopId: "loop-research-1",
                ownerType: "profile",
                ownerSlug: "research",
                iterations: [
                  { index: 0, phase: "handoff", status: "completed" },
                ],
              },
            },
            {
              profileRunId: "reviewer-1",
              profileId: "profile-reviewer",
              profileSlug: "reviewer",
              profileName: "Reviewer",
              model: "anthropic.claude-haiku",
              status: "completed",
              inputTokens: 30,
              outputTokens: 10,
              durationMs: 200,
              loopEvidence: {
                loopId: "loop-reviewer-1",
                ownerType: "profile",
                ownerSlug: "reviewer",
                iterations: [
                  {
                    index: 0,
                    phase: "final_review",
                    status: "completed",
                    verdict: "pass",
                  },
                ],
              },
            },
            {
              profileRunId: "research-2",
              profileId: "profile-research",
              profileSlug: "research",
              profileName: "Research",
              model: "anthropic.claude-haiku",
              status: "completed",
              inputTokens: 50,
              outputTokens: 15,
              durationMs: 600,
              loopEvidence: {
                loopId: "loop-research-2",
                ownerType: "profile",
                ownerSlug: "research",
                iterations: [
                  {
                    index: 1,
                    phase: "iteration",
                    status: "completed",
                  },
                ],
              },
            },
          ],
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 1000,
          output_tokens: 200,
          cached_read_tokens: 5,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    const succeededUpdate = mocks.updateSets.find((value: any) =>
      Boolean(value?.usage_json?.agent_profile_runs),
    ) as any;
    expect(succeededUpdate.usage_json).toMatchObject({
      input_tokens: 1180,
      output_tokens: 245,
      cached_read_tokens: 5,
      cost_usd: 4.92,
      parent_usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cached_read_tokens: 5,
        cost_usd: 1.23,
      },
    });
    expect(succeededUpdate.usage_json.agent_profile_runs).toEqual([
      expect.objectContaining({ profileRunId: "research-1" }),
      expect.objectContaining({
        profileRunId: "reviewer-1",
        loopEvidence: expect.objectContaining({
          ownerSlug: "reviewer",
          iterations: [
            expect.objectContaining({
              phase: "final_review",
              verdict: "pass",
            }),
          ],
        }),
      }),
      expect.objectContaining({
        profileRunId: "research-2",
        loopEvidence: expect.objectContaining({
          iterations: [
            expect.objectContaining({
              index: 1,
              phase: "iteration",
            }),
          ],
        }),
      }),
    ]);
    expect(mocks.recordCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: `${TURN_ID}:profile:reviewer-1:model`,
        metadata: expect.objectContaining({
          profile_slug: "reviewer",
          loop_owner_slug: "reviewer",
          loop_phase: "final_review",
          loop_verdict: "pass",
          reviewer_role: true,
        }),
      }),
    );
  });

  it("records failed Agent Profile runs as events without child LLM cost rows", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 50,
        status: "completed",
        response: {
          content: "Parent summary",
          agent_profile_runs: [
            {
              profileRunId: "profile-run-2",
              profileId: "profile-analyst",
              profileSlug: "analyst",
              profileName: "Analyst",
              model: "moonshotai.kimi-k2.5",
              status: "timed_out",
              error: "timeout",
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    expect(mocks.recordCostEvents).toHaveBeenCalledTimes(1);
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "agent_profile_run",
        level: "error",
        payload: expect.objectContaining({
          profile_run_id: "profile-run-2",
          profile_slug: "analyst",
          status: "timed_out",
          error: "timeout",
        }),
      }),
    );
  });

  it("attributes parent composer model usage to non-routed tool invocations", async () => {
    mocks.recordCostEvents.mockResolvedValueOnce({
      totalUsd: 0.008799,
      llmUsd: 0.008799,
      computeUsd: 0,
    });

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: {
          content: "Patrick Collison is the CEO of Stripe.",
          tools_called: ["web_search", "web_extract"],
          tool_invocations: [
            {
              id: "tool-search",
              tool_name: "web_search",
              input_preview: '{"query":"Stripe CEO"}',
              output_preview: "Search results",
            },
            {
              id: "tool-extract",
              tool_name: "web_extract",
              input_preview: '{"url":"https://stripe.com"}',
              output_preview: "Extracted page",
            },
          ],
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 12,
          output_tokens: 417,
          cached_read_tokens: 17500,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    const succeededUpdate = mocks.updateSets.find((value: any) =>
      Boolean(value?.usage_json?.tool_invocations),
    ) as any;
    const invocations = succeededUpdate.usage_json.tool_invocations;

    expect(succeededUpdate.usage_json).toMatchObject({
      model: "moonshotai.kimi-k2.5",
      input_tokens: 12,
      output_tokens: 417,
      cached_read_tokens: 17500,
      cost_usd: 0.008799,
    });
    expect(invocations).toEqual([
      expect.objectContaining({
        id: "tool-search",
        model: "moonshotai.kimi-k2.5",
        input_tokens: 6,
        output_tokens: 209,
        cached_read_tokens: 8750,
        cost_usd: expect.closeTo(0.0043995, 10),
        model_routing_status: "parent_model",
        model_routing_match: {
          tool: "web_search",
          fallback: "composer_model",
        },
      }),
      expect.objectContaining({
        id: "tool-extract",
        model: "moonshotai.kimi-k2.5",
        input_tokens: 6,
        output_tokens: 208,
        cached_read_tokens: 8750,
        cost_usd: expect.closeTo(0.0043995, 10),
        model_routing_status: "parent_model",
        model_routing_match: {
          tool: "web_extract",
          fallback: "composer_model",
        },
      }),
    ]);
    const attributedCost = invocations.reduce(
      (sum: number, invocation: any) => sum + invocation.cost_usd,
      0,
    );
    expect(attributedCost).toBeCloseTo(0.008799, 12);
  });

  it("records wiki context metadata in turn usage and thread events", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: {
          content: "Acme renewal depends on pricing approval.",
          tools_called: ["query_wiki_context"],
          tool_invocations: [
            {
              id: "tool-wiki",
              tool_name: "query_wiki_context",
              args: { query: "Acme renewal" },
              result: {
                content: [{ type: "text", text: "Acme Renewal" }],
                details: {
                  wiki_context: {
                    surface: "query_wiki_context",
                    retrieval_mode: "db",
                    query: "Acme renewal",
                    scope: "auto",
                    mode: "results",
                    depth: "quick",
                    result_count: 3,
                    top_pages: [
                      {
                        id: "page-1",
                        title: "Acme Renewal",
                        slug: "acme-renewal",
                        type: "entity",
                      },
                    ],
                    answered_from_db: true,
                  },
                },
              },
              output_preview: "Acme Renewal",
            },
          ],
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 12,
          output_tokens: 417,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    const succeededUpdate = mocks.updateSets.find((value: any) =>
      Boolean(value?.usage_json?.tool_invocations),
    ) as any;
    expect(succeededUpdate.usage_json.tool_invocations).toEqual([
      expect.objectContaining({
        id: "tool-wiki",
        tool_name: "query_wiki_context",
        wiki_context: expect.objectContaining({
          retrieval_mode: "db",
          query: "Acme renewal",
          result_count: 3,
          top_pages: [
            expect.objectContaining({
              title: "Acme Renewal",
              slug: "acme-renewal",
            }),
          ],
        }),
      }),
    ]);
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "wiki_context_result",
        message: 'Wiki returned 3 pages for "Acme renewal"',
        payload: expect.objectContaining({
          tool_call_id: "tool-wiki",
          tool_name: "query_wiki_context",
          query: "Acme renewal",
          result_count: 3,
        }),
      }),
    );
  });

  it("records OKF wiki trace metadata in turn usage and thread events", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        trace_id: "trace-okf",
        duration_ms: 25,
        status: "completed",
        response: {
          content: "Acme renewal depends on pricing approval.",
          tools_called: ["wiki_rg"],
          tool_invocations: [
            {
              id: "tool-okf",
              tool_name: "wiki_rg",
              result: {
                content: [{ type: "text", text: "OKF wiki matches" }],
                details: {
                  okfWikiTrace: {
                    surface: "okf_efs",
                    tool: "wiki_rg",
                    query: "Acme",
                    path: "topics",
                    matchCount: 1,
                    entries: [
                      {
                        path: "topics/acme.md",
                        title: "Acme",
                        absolutePath:
                          "/mnt/thinkwork-okf/tenants/acme/current/topics/acme.md",
                      },
                    ],
                    bounds: {
                      maxResults: 5,
                      maxDepth: 2,
                      maxBytes: 128_000,
                      truncated: true,
                    },
                    redaction: {
                      source: "okf_navigator",
                      policy: "cite_or_summarize_only",
                    },
                  },
                },
              },
              output_preview: "OKF wiki matches",
            },
          ],
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 12,
          output_tokens: 417,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    const succeededUpdate = mocks.updateSets.find((value: any) =>
      Boolean(value?.usage_json?.tool_invocations),
    ) as any;
    expect(succeededUpdate.usage_json.tool_invocations).toEqual([
      expect.objectContaining({
        id: "tool-okf",
        tool_name: "wiki_rg",
        okf_wiki_trace: expect.objectContaining({
          surface: "okf_efs",
          tool: "wiki_rg",
          tool_call_id: "tool-okf",
          query: "Acme",
          path: "topics",
          matchCount: 1,
          truncated: true,
        }),
      }),
    ]);
    expect(
      JSON.stringify(succeededUpdate.usage_json.tool_invocations),
    ).not.toContain("/mnt/thinkwork-okf");
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "wiki_context_trace",
        message: 'OKF wiki search returned 1 item for "Acme"',
        color: "amber",
        payload: expect.objectContaining({
          tool_call_id: "tool-okf",
          tool: "wiki_rg",
          query: "Acme",
          path: "topics",
          matchCount: 1,
        }),
      }),
    );
  });

  it("records OKF wiki navigator traces in turn usage and thread events", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: {
          content: "Acme renewal links to pricing approval.",
          tools_called: ["wiki_rg"],
          tool_invocations: [
            {
              id: "tool-okf-wiki",
              tool_name: "wiki_rg",
              args: { query: "Acme renewal" },
              result: {
                content: [{ type: "text", text: "Acme Renewal" }],
                details: {
                  okfWikiTrace: {
                    surface: "okf_efs",
                    tool: "wiki_rg",
                    query: "Acme renewal",
                    path: ".",
                    matchCount: 2,
                    root: "/mnt/thinkwork-okf/tenants/acme/current",
                    s3Key: "s3://thinkwork-okf/tenants/acme/current.json",
                    entries: [
                      {
                        path: "topics/acme-renewal.md",
                        title: "Acme Renewal",
                        line: 12,
                        snippet:
                          "Renewal depends on s3://thinkwork-okf/tenants/acme/private.md",
                        absolutePath:
                          "/mnt/thinkwork-okf/tenants/acme/current/topics/acme-renewal.md",
                      },
                    ],
                    bounds: {
                      maxResults: 50,
                      maxDepth: 8,
                      maxBytes: 128_000,
                      truncated: false,
                    },
                    redaction: {
                      source: "okf_navigator",
                      policy: "cite_or_summarize_only",
                    },
                  },
                },
              },
              output_preview: "Acme Renewal",
            },
          ],
        },
        usage: {
          model: "moonshotai.kimi-k2.5",
          input_tokens: 12,
          output_tokens: 417,
        },
      }),
    ).resolves.toMatchObject({ finalized: true });

    const succeededUpdate = mocks.updateSets.find((value: any) =>
      Boolean(value?.usage_json?.tool_invocations),
    ) as any;
    const invocation = succeededUpdate.usage_json.tool_invocations[0];
    expect(invocation).toMatchObject({
      id: "tool-okf-wiki",
      tool_name: "wiki_rg",
      okf_wiki_trace: expect.objectContaining({
        surface: "okf_efs",
        tool: "wiki_rg",
        tool_call_id: "tool-okf-wiki",
        query: "Acme renewal",
        path: ".",
        matchCount: 2,
        entries: [
          expect.objectContaining({
            path: "topics/acme-renewal.md",
            title: "Acme Renewal",
          }),
        ],
        redaction: {
          source: "okf_navigator",
          policy: "cite_or_summarize_only",
        },
      }),
    });
    expect(JSON.stringify(invocation.okf_wiki_trace)).not.toContain(
      "/mnt/thinkwork-okf",
    );
    expect(JSON.stringify(invocation.okf_wiki_trace)).not.toContain("s3://");
    expect(JSON.stringify(invocation.okf_wiki_trace)).not.toContain("s3Key");
    expect(mocks.appendThreadTurnEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "wiki_context_trace",
        message: 'OKF wiki search returned 2 items for "Acme renewal"',
        payload: expect.objectContaining({
          surface: "okf_efs",
          tool: "wiki_rg",
          tool_call_id: "tool-okf-wiki",
          query: "Acme renewal",
          matchCount: 2,
        }),
      }),
    );
  });

  it("does not overwrite explicit routed model evidence with parent fallback attribution", async () => {
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
          tool_invocations: [
            {
              id: "tool-1",
              tool_name: "mcp_twenty-crm_execute_tool",
              model_routing: {
                match: { serverName: "twenty-crm" },
                model: "anthropic.claude-haiku",
                status: "completed",
                inputTokens: 100,
                outputTokens: 20,
                cachedReadTokens: 5,
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

    const succeededUpdate = mocks.updateSets.find((value: any) =>
      Boolean(value?.usage_json?.tool_invocations),
    ) as any;
    expect(succeededUpdate.usage_json.tool_invocations).toEqual([
      expect.objectContaining({
        model: "anthropic.claude-haiku",
        input_tokens: 100,
        output_tokens: 20,
        cached_read_tokens: 5,
        cost_usd: 1.23,
        model_routing_status: "completed",
      }),
    ]);
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

describe("turnAskedUserQuestion", () => {
  it("detects the ask tool in tools_called", () => {
    expect(
      turnAskedUserQuestion({ tools_called: ["bash", "ask_user_question"] }),
    ).toBe(true);
  });

  it("detects the ask tool across tool_invocations name-key variants", () => {
    expect(
      turnAskedUserQuestion({
        tool_invocations: [{ toolName: "ask_user_question" }],
      }),
    ).toBe(true);
    expect(
      turnAskedUserQuestion({
        tool_invocations: [{ tool_name: "ask_user_question" }],
      }),
    ).toBe(true);
    expect(
      turnAskedUserQuestion({
        tool_invocations: [{ name: "ask_user_question" }],
      }),
    ).toBe(true);
  });

  it("returns false for ordinary turns", () => {
    expect(
      turnAskedUserQuestion({
        tools_called: ["bash"],
        tool_invocations: [{ toolName: "web_search" }],
      }),
    ).toBe(false);
    expect(turnAskedUserQuestion({})).toBe(false);
  });
});

describe("processFinalize workspace projection reconcile merge (plan 2026-06-12-002 U6)", () => {
  const payload = {
    thread_turn_id: TURN_ID,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    thread_id: THREAD_ID,
    duration_ms: 25,
    status: "completed" as const,
    response: { content: "done" },
  };

  it("merges a compact reconcile summary into the projection after reconcile completes", async () => {
    mocks.reconcileChangedFiles.mockResolvedValue({
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
          path: "Spaces/other/file.md",
          op: "modify",
          owner: "space",
          status: "rejected",
          code: "lane_violation",
          message: "foreign space",
        },
      ],
    });

    await expect(processFinalize(payload)).resolves.toMatchObject({
      finalized: true,
    });

    expect(
      mocks.mergeWorkspaceProjectionReconcileSummary,
    ).toHaveBeenCalledTimes(1);
    expect(mocks.mergeWorkspaceProjectionReconcileSummary).toHaveBeenCalledWith(
      TURN_ID,
      expect.objectContaining({
        rejectedCount: 1,
        rejections: [{ path: "Spaces/other/file.md", code: "lane_violation" }],
        updatedAt: expect.any(String),
      }),
    );
  });

  it("finalize succeeds even when the projection merge fails (additive, never blocking)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.mergeWorkspaceProjectionReconcileSummary.mockRejectedValue(
      new Error("aurora hiccup"),
    );

    await expect(processFinalize(payload)).resolves.toMatchObject({
      finalized: true,
      messageId: "msg-1",
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("workspace projection reconcile merge failed"),
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("skips the merge when reconcile itself fails — the dispatch-time snapshot stays as-is", async () => {
    mocks.reconcileChangedFiles.mockRejectedValue(new Error("s3 down"));

    await expect(processFinalize(payload)).rejects.toThrow("s3 down");
    expect(
      mocks.mergeWorkspaceProjectionReconcileSummary,
    ).not.toHaveBeenCalled();
  });
});

describe("processFinalize asking-turn behavior (plan 2026-06-09-005 U3)", () => {
  const askingPayload = {
    thread_turn_id: TURN_ID,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    thread_id: THREAD_ID,
    duration_ms: 25,
    status: "completed" as const,
    response: {
      content: "I have a couple of questions before I proceed.",
      tools_called: ["ask_user_question"],
    },
  };

  it("sets last_response_preview from the pending question text and suppresses the push", async () => {
    mocks.selectRows = [
      {
        questions: [
          {
            question: "Which environment should I deploy to?",
            header: "Environment",
            options: [],
          },
        ],
      },
    ];

    await expect(processFinalize(askingPayload)).resolves.toMatchObject({
      finalized: true,
      messageId: "msg-1",
    });

    // The trailing assistant text still persists as a normal message…
    expect(mocks.insertAssistantMessage).toHaveBeenCalled();
    // …but the thread preview shows the QUESTION, not the trailing prose.
    const threadUpdate = mocks.updateSets.find(
      (set) =>
        set &&
        typeof set === "object" &&
        "last_response_preview" in (set as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;
    expect(threadUpdate?.last_response_preview).toBe(
      "Which environment should I deploy to?",
    );
    // The thread is waiting on the user, not done: no turn-completed push.
    expect(mocks.sendTurnCompletedPush).not.toHaveBeenCalled();
  });

  it("sends the push when the ask tool ran but NO pending row exists (failed/409'd ask)", async () => {
    // tools_called records at execution START, so the ask tool name alone
    // is not proof a question is pending — suppression is gated on the
    // pending-row probe. With no row, the turn finalizes normally.
    mocks.selectRows = [];

    await processFinalize(askingPayload);

    const threadUpdate = mocks.updateSets.find(
      (set) =>
        set &&
        typeof set === "object" &&
        "last_response_preview" in (set as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;
    expect(threadUpdate?.last_response_preview).toBe(
      "I have a couple of questions before I proceed.",
    );
    expect(mocks.sendTurnCompletedPush).toHaveBeenCalledTimes(1);
  });

  it("leaves normal turns unaffected: preview from the response text + push sent", async () => {
    await processFinalize({
      ...askingPayload,
      response: { content: "All done!", tools_called: ["bash"] },
    });

    const threadUpdate = mocks.updateSets.find(
      (set) =>
        set &&
        typeof set === "object" &&
        "last_response_preview" in (set as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;
    expect(threadUpdate?.last_response_preview).toBe("All done!");
    expect(mocks.sendTurnCompletedPush).toHaveBeenCalledTimes(1);
  });

  it("forwards validated UI message parts into assistant message persistence", async () => {
    const part = createTaskReviewGenUIFixture();
    const persistedPart = part as unknown as Record<string, unknown>;

    await processFinalize({
      ...askingPayload,
      response: {
        content: "Here is the review.",
        tools_called: ["review_task"],
        ui_message_parts: [persistedPart],
      },
    });

    expect(mocks.insertAssistantMessage).toHaveBeenCalledWith(
      THREAD_ID,
      TENANT_ID,
      AGENT_ID,
      "Here is the review.",
      expect.any(Array),
      [persistedPart],
      undefined,
    );
  });
});

describe("processFinalize deferred-wakeup promotion", () => {
  it("promotes the next deferred wakeup for the thread once the turn finalizes", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: { content: "done" },
      }),
    ).resolves.toMatchObject({ finalized: true });

    // A deferred question_answer wakeup (card answered mid-turn) would
    // otherwise be stranded — promotion flips it to 'queued' for the
    // wakeup-processor's poll.
    expect(mocks.promoteNextDeferredWakeup).toHaveBeenCalledWith(
      TENANT_ID,
      THREAD_ID,
    );
    expect(mocks.finalizeN8nAgentStepRun).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      threadTurnId: TURN_ID,
      resolution: "turn_completed",
      summary: "done",
      output: { response: "done" },
    });
  });

  it("records failed turns against n8n bridge runs after normal failure finalization", async () => {
    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "failed",
        error_message: "agent crashed",
      }),
    ).resolves.toMatchObject({ finalized: true, messageId: null });

    expect(mocks.finalizeN8nAgentStepRun).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      threadTurnId: TURN_ID,
      resolution: "turn_failed",
      error: "agent crashed",
      summary: "agent crashed",
    });
  });

  it("does not promote on idempotent re-entry (turn already finalized)", async () => {
    mocks.updateReturning = [[]]; // claim fails — already finalized

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: { content: "done" },
      }),
    ).resolves.toMatchObject({ finalized: false });

    expect(mocks.promoteNextDeferredWakeup).not.toHaveBeenCalled();
    expect(mocks.finalizeN8nAgentStepRun).not.toHaveBeenCalled();
  });

  it("a promotion failure does not fail the finalize", async () => {
    mocks.promoteNextDeferredWakeup.mockRejectedValue(new Error("db down"));

    await expect(
      processFinalize({
        thread_turn_id: TURN_ID,
        tenant_id: TENANT_ID,
        agent_id: AGENT_ID,
        thread_id: THREAD_ID,
        duration_ms: 25,
        status: "completed",
        response: { content: "done" },
      }),
    ).resolves.toMatchObject({ finalized: true });
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
