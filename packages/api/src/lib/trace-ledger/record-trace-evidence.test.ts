import { describe, expect, it } from "vitest";
import { buildTraceEvidencePlan } from "./record-trace-evidence";

const baseInput = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  agentId: "22222222-2222-2222-2222-222222222222",
  userId: "55555555-5555-5555-5555-555555555555",
  threadId: "33333333-3333-3333-3333-333333333333",
  threadTurnId: "44444444-4444-4444-4444-444444444444",
  traceId: "trace-1",
  runtimeType: "pi",
  status: "completed",
  durationMs: 1234,
  responseText: "Done.",
  usage: {
    model: "moonshotai.kimi-k2.5",
    inputTokens: 100,
    outputTokens: 20,
    cachedReadTokens: 5,
    costUsd: 0.00123,
  },
};

describe("buildTraceEvidencePlan", () => {
  it("plans a turn root, parent model, runtime compute, tools, routed model, workspace, profile, and finalization", () => {
    const plan = buildTraceEvidencePlan({
      ...baseInput,
      diagnostics: {
        agentcore_phases: [
          {
            phase: "runtime.workspace_bootstrap",
            status: "completed",
            duration_ms: 42,
          },
        ],
        workspace_diagnostics: {
          reconcile_status: "partial_success",
          reconcile_writeback_ms: 17,
          changed_files: 2,
        },
      },
      reconcile: { status: "partial_success", files: [{ path: "README.md" }] },
      toolInvocations: [
        {
          id: "tool-1",
          tool_name: "workspace_skill",
          duration_ms: 88,
          model: "anthropic.claude-haiku",
          input_tokens: 12,
          output_tokens: 3,
          cached_read_tokens: 1,
          cost_usd: 0.0001,
        },
      ],
      modelRoutedToolCalls: [
        {
          toolCallId: "tool-1",
          toolName: "workspace_skill",
          model: "anthropic.claude-haiku",
          status: "completed",
          inputTokens: 12,
          outputTokens: 3,
          cachedReadTokens: 1,
          durationMs: 88,
          costUsd: 0.0001,
          match: { slug: "research" },
          ruleSource: { owner: "user" },
        },
      ],
      agentProfileRuns: [
        {
          profileRunId: "profile-run-1",
          profileId: "profile-1",
          profileSlug: "analyst",
          profileName: "Analyst",
          model: "anthropic.claude-haiku",
          status: "completed",
          durationMs: 250,
          inputTokens: 40,
          outputTokens: 9,
          cachedReadTokens: 0,
          costUsd: 0.0004,
          laneKey: "profile:analyst",
        },
      ],
    });

    expect(plan.traceId).toBe("trace-1");
    expect(plan.events.map((event) => [event.key, event.eventType])).toEqual([
      ["turn", "turn"],
      ["parent-model", "model_invocation"],
      ["runtime-compute", "runtime_phase"],
      ["runtime-phase-0", "workspace_hydration"],
      ["workspace-reconcile", "workspace_hydration"],
      ["tool-tool-1", "tool_invocation"],
      ["routed-model-tool-1", "model_invocation"],
      ["profile-profile-run-1", "agent_profile_run"],
      ["response-finalization", "response_finalization"],
    ]);
    expect(
      plan.events.find((event) => event.key === "routed-model-tool-1"),
    ).toMatchObject({
      parentKey: "tool-tool-1",
      requestId: `${baseInput.threadTurnId}:tool:tool-1:model`,
      payloadSummary: expect.objectContaining({
        model: "anthropic.claude-haiku",
        input_tokens: 12,
        output_tokens: 3,
      }),
    });
    expect(plan.costLinks).toEqual(
      expect.arrayContaining([
        {
          eventKey: "parent-model",
          requestId: baseInput.threadTurnId,
          eventType: "llm",
          attributionLevel: "turn_parent_model",
        },
        {
          eventKey: "runtime-compute",
          requestId: baseInput.threadTurnId,
          eventType: "agentcore_compute",
          attributionLevel: "runtime_compute",
        },
        {
          eventKey: "routed-model-tool-1",
          requestId: `${baseInput.threadTurnId}:tool:tool-1:model`,
          eventType: "llm",
          attributionLevel: "model_routed_tool",
        },
        {
          eventKey: "profile-profile-run-1",
          requestId: `${baseInput.threadTurnId}:profile:profile-run-1:model`,
          eventType: "llm",
          attributionLevel: "agent_profile_run",
        },
      ]),
    );
  });

  it("preserves runtime-reported zero-token usage as low-confidence model evidence", () => {
    const plan = buildTraceEvidencePlan({
      ...baseInput,
      usage: {
        model: "moonshotai.kimi-k2.5",
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        costUsd: 0,
      },
    });

    expect(plan.events.find((event) => event.key === "parent-model")).toEqual(
      expect.objectContaining({
        eventType: "model_invocation",
        payloadSummary: expect.objectContaining({
          runtime_reported_zero_tokens: true,
          input_tokens: 0,
          output_tokens: 0,
        }),
      }),
    );
    expect(plan.costLinks).toContainEqual({
      eventKey: "parent-model",
      requestId: baseInput.threadTurnId,
      eventType: "llm",
      attributionLevel: "turn_parent_model",
    });
  });

  it("falls back to the thread turn id as trace identity when runtime trace id is missing", () => {
    const plan = buildTraceEvidencePlan({
      ...baseInput,
      traceId: null,
    });

    expect(plan.traceId).toBe(baseInput.threadTurnId);
    expect(plan.events[0].sourceEvidenceRef).toMatchObject({
      trace_id: baseInput.threadTurnId,
      thread_turn_id: baseInput.threadTurnId,
    });
  });
});
