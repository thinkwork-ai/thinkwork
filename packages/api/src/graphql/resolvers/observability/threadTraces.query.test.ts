import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

function queryChain() {
  return {
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => mocks.rows,
            }),
          }),
        }),
      }),
    }),
  };
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => queryChain(),
  },
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
  sql: vi.fn(() => "sql"),
  agents: {
    id: "agents.id",
    name: "agents.name",
  },
}));

import { threadTraces } from "./threadTraces.query";

describe("threadTraces", () => {
  it("projects canonical trace events with reconciliation and source evidence", async () => {
    const createdAt = new Date("2026-06-06T12:00:00.000Z");
    mocks.rows = [
      {
        traceId: "trace-1",
        requestId: "turn-1:tool:tool-1:model",
        parentRequestId: "turn-1",
        eventType: "model_invocation",
        eventStatus: "completed",
        threadId: "thread-1",
        threadTurnId: "turn-1",
        agentId: "agent-1",
        agentName: "Agent",
        runtimeType: "pi",
        durationMs: null,
        payloadSummary: {
          model: "anthropic.claude-haiku",
          input_tokens: 100,
          output_tokens: 20,
          cost_usd: 0.001,
          tool_call_id: "tool-1",
          tool_name: "workspace_skill",
        },
        sourceEvidenceRef: {},
        metadata: {
          source: "pi_tool_model_route",
          model_routing_status: "completed",
          rule_source: { owner: "user", path: "User/TOOLS.md" },
          match: { slug: "research" },
        },
        observedAt: createdAt,
        createdAt,
        costEventModel: null,
        costEventInputTokens: null,
        costEventOutputTokens: null,
        costEventAmountUsd: null,
        costEventReconciliationState: null,
        reconciliationState: "invocation-reconciled",
        reconciliationSource: "invocation",
        factModel: "anthropic.claude-haiku",
        factInputTokens: 100,
        factOutputTokens: 20,
        factAmountUsd: 0.0011,
        sourceEvidence: [
          {
            id: "source-1",
            traceRunId: "run-1",
            traceEventId: "event-1",
            sourceType: "bedrock_invocation_log",
            sourceSystem: "aws.bedrock",
            sourceId: "bedrock-request-1",
            uri: "cloudwatch://group/stream",
            observedAt: createdAt,
            summary: { model: "anthropic.claude-haiku" },
            redactionState: "summary_only",
            retentionExpiresAt: null,
            metadata: { requestId: "bedrock-request-1" },
            createdAt,
          },
        ],
      },
      {
        traceId: "trace-1",
        requestId: "turn-1:profile:profile-run-1:model",
        parentRequestId: "turn-1",
        eventType: "agent_profile_run",
        eventStatus: "completed",
        threadId: "thread-1",
        threadTurnId: "turn-1",
        agentId: "agent-1",
        agentName: "Agent",
        runtimeType: "pi",
        durationMs: 900,
        payloadSummary: {
          model: "anthropic.claude-haiku",
          input_tokens: 120,
          output_tokens: 40,
        },
        sourceEvidenceRef: { source_type: "runtime" },
        metadata: {
          source: "pi_agent_profile",
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
          loop_evidence: {
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
        },
        observedAt: createdAt,
        createdAt,
        costEventModel: null,
        costEventInputTokens: null,
        costEventOutputTokens: null,
        costEventAmountUsd: null,
        costEventReconciliationState: "runtime-reported",
        reconciliationState: null,
        reconciliationSource: null,
        factModel: null,
        factInputTokens: null,
        factOutputTokens: null,
        factAmountUsd: null,
        sourceEvidence: [],
      },
      {
        traceId: "trace-1",
        requestId: "turn-1",
        parentRequestId: null,
        eventType: "model_invocation",
        eventStatus: "succeeded",
        threadId: "thread-1",
        threadTurnId: "turn-1",
        agentId: "agent-1",
        agentName: "Agent",
        runtimeType: "pi",
        durationMs: 5000,
        payloadSummary: {},
        sourceEvidenceRef: { source_type: "runtime" },
        metadata: { source: "agent_invoke", estimated: false },
        observedAt: createdAt,
        createdAt,
        costEventModel: "moonshotai.kimi-k2.5",
        costEventInputTokens: 1000,
        costEventOutputTokens: 200,
        costEventAmountUsd: 0.01,
        costEventReconciliationState: "runtime-reported",
        reconciliationState: null,
        reconciliationSource: null,
        factModel: null,
        factInputTokens: null,
        factOutputTokens: null,
        factAmountUsd: null,
        sourceEvidence: [],
      },
    ];

    await expect(
      threadTraces(
        null,
        { tenantId: "tenant-1", threadId: "thread-1" },
        {} as never,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        requestId: "turn-1:tool:tool-1:model",
        eventType: "model_invocation",
        source: "pi_tool_model_route",
        parentRequestId: "turn-1",
        toolCallId: "tool-1",
        toolName: "workspace_skill",
        modelRoutingStatus: "completed",
        model: "anthropic.claude-haiku",
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.001,
        reconciliationState: "invocation-reconciled",
        reconciliationSource: "invocation",
        ruleSource: { owner: "user", path: "User/TOOLS.md" },
        match: { slug: "research" },
        sourceEvidence: [
          expect.objectContaining({
            sourceType: "bedrock_invocation_log",
            sourceSystem: "aws.bedrock",
            sourceId: "bedrock-request-1",
            observedAt: "2026-06-06T12:00:00.000Z",
          }),
        ],
        createdAt: "2026-06-06T12:00:00.000Z",
      }),
      expect.objectContaining({
        requestId: "turn-1:profile:profile-run-1:model",
        source: "pi_agent_profile",
        parentRequestId: "turn-1",
        profileRunId: "profile-run-1",
        profileId: "profile-research",
        profileSlug: "research",
        profileName: "Research",
        laneKey: "profile:research",
        profileStatus: "completed",
        loopId: "loop-research-1",
        loopOwnerType: "profile",
        loopOwnerSlug: "research",
        loopIterationIndex: 0,
        loopPhase: "handoff",
        loopStatus: "completed",
        loopVerdict: "pass",
        reviewerRole: false,
        reconciliationState: "runtime-reported",
        loopEvidence: {
          loopId: "loop-research-1",
          ownerType: "profile",
          ownerSlug: "research",
          iterations: [
            expect.objectContaining({
              phase: "handoff",
              verdict: "pass",
            }),
          ],
        },
      }),
      expect.objectContaining({
        requestId: "turn-1",
        source: "agent_invoke",
        model: "moonshotai.kimi-k2.5",
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.01,
        toolCallId: null,
      }),
    ]);
  });
});
