import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => mocks.rows,
            }),
          }),
        }),
      }),
    }),
  },
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
  sql: vi.fn(() => "sql"),
  costEvents: {
    trace_id: "cost_events.trace_id",
    request_id: "cost_events.request_id",
    event_type: "cost_events.event_type",
    thread_id: "cost_events.thread_id",
    agent_id: "cost_events.agent_id",
    runtime_type: "cost_events.runtime_type",
    model: "cost_events.model",
    input_tokens: "cost_events.input_tokens",
    output_tokens: "cost_events.output_tokens",
    duration_ms: "cost_events.duration_ms",
    metadata: "cost_events.metadata",
    created_at: "cost_events.created_at",
    tenant_id: "cost_events.tenant_id",
  },
  agents: {
    id: "agents.id",
    name: "agents.name",
  },
}));

import { threadTraces } from "./threadTraces.query";

describe("threadTraces", () => {
  it("exposes parent and child model route metadata separately", async () => {
    const createdAt = new Date("2026-06-06T12:00:00.000Z");
    mocks.rows = [
      {
        traceId: "trace-1",
        requestId: "turn-1:tool:tool-1:model",
        eventType: "llm",
        threadId: "thread-1",
        agentId: "agent-1",
        agentName: "Agent",
        runtimeType: "pi",
        model: "anthropic.claude-haiku",
        inputTokens: 100,
        outputTokens: 20,
        durationMs: null,
        costUsd: 0.001,
        metadata: {
          source: "pi_tool_model_route",
          parent_request_id: "turn-1",
          tool_call_id: "tool-1",
          tool_name: "workspace_skill",
          model_routing_status: "completed",
          rule_source: { owner: "user", path: "User/TOOLS.md" },
          match: { slug: "research" },
        },
        createdAt,
      },
      {
        traceId: "trace-1",
        requestId: "turn-1:profile:profile-run-1:model",
        eventType: "llm",
        threadId: "thread-1",
        agentId: "agent-1",
        agentName: "Agent",
        runtimeType: "pi",
        model: "anthropic.claude-haiku",
        inputTokens: 120,
        outputTokens: 40,
        durationMs: 900,
        costUsd: 0.002,
        metadata: {
          source: "pi_agent_profile",
          parent_request_id: "turn-1",
          profile_run_id: "profile-run-1",
          profile_id: "profile-research",
          profile_slug: "research",
          profile_name: "Research",
          lane_key: "profile:research",
          profile_status: "completed",
        },
        createdAt,
      },
      {
        traceId: "trace-1",
        requestId: "turn-1",
        eventType: "llm",
        threadId: "thread-1",
        agentId: "agent-1",
        agentName: "Agent",
        runtimeType: "pi",
        model: "moonshotai.kimi-k2.5",
        inputTokens: 1000,
        outputTokens: 200,
        durationMs: 5000,
        costUsd: 0.01,
        metadata: { source: "agent_invoke", estimated: false },
        createdAt,
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
        source: "pi_tool_model_route",
        parentRequestId: "turn-1",
        toolCallId: "tool-1",
        toolName: "workspace_skill",
        modelRoutingStatus: "completed",
        ruleSource: { owner: "user", path: "User/TOOLS.md" },
        match: { slug: "research" },
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
      }),
      expect.objectContaining({
        requestId: "turn-1",
        source: "agent_invoke",
        toolCallId: null,
      }),
    ]);
  });
});
