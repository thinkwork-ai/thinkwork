import { describe, expect, it, vi } from "vitest";
import { createTaskReviewJsonRenderFixture } from "@thinkwork/thread-json-render";

import {
  buildFinalizeBody,
  isFinalizeCallbackConfigured,
  postFinalizeCallback,
} from "../src/finalize-client.js";
import type { RunAgentLoopResult } from "../src/types.js";

const identity = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  threadId: "thread-1",
};

const runResult: RunAgentLoopResult = {
  content: "done",
  modelId: "amazon.nova-pro-v1:0",
  toolsCalled: ["lookup"],
  toolInvocations: [
    {
      id: "tool-1",
      name: "lookup",
      tool_name: "lookup",
      runtime: "pi",
      result: {
        tool_costs: [
          {
            provider: "test",
            event_type: "tool",
            amount_usd: "0.001",
          },
        ],
      },
    },
  ],
  toolCosts: [
    {
      provider: "test",
      event_type: "tool",
      amount_usd: "0.001",
    },
  ],
  uiMessageParts: [createTaskReviewJsonRenderFixture()],
  usage: {
    input: 5,
    output: 7,
    cacheRead: 2,
    cacheWrite: 0,
    totalTokens: 14,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  diagnostics: {
    local_pi_timings_ms: {
      workspace_sync_ms: 12,
      sdk_prompt_ms: 34,
      total_ms: 56,
    },
  },
  goalRun: {
    source: "pi_goal",
    action: "start",
    goal_id: "goal-1",
    objective: "finish billing",
    status: "paused",
    iteration: 1,
    token_budget: 100000,
    tokens_used: 500,
    continuation_policy: "thinkwork_managed",
  },
};

describe("buildFinalizeBody", () => {
  it("builds the chat-finalize payload shape from a successful Pi run", () => {
    const body = buildFinalizeBody({
      payload: {
        thread_turn_id: "turn-1",
        trace_id: "trace-1",
        message: "hello",
        instance_id: "agent-slug",
        agent_name: "Pi",
        runtime_host: "desktop-local",
      },
      identity,
      systemPrompt: "system",
      changedFiles: [
        {
          path: "memory/preferences.md",
          op: "modify",
          content: "# Preferences\n",
          base_etag: '"old"',
        },
        { path: "scratch/tmp.md", op: "delete", base_etag: '"tmp"' },
      ],
      result: { status: "ok", runResult, latencyMs: 123 },
      fetchImpl: fetch,
    });

    expect(body).toMatchObject({
      thread_turn_id: "turn-1",
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      thread_id: "thread-1",
      runtime_type: "pi",
      status: "completed",
      composed_system_prompt: "system",
      changed_files: [
        {
          path: "memory/preferences.md",
          op: "modify",
          content: "# Preferences\n",
          base_etag: '"old"',
        },
        { path: "scratch/tmp.md", op: "delete", base_etag: '"tmp"' },
      ],
      response: {
        content: "done",
        runtime: "pi",
        runtime_host: "desktop-local",
        tools_called: ["lookup"],
        ui_message_parts: runResult.uiMessageParts,
        goal_run: runResult.goalRun,
        tool_costs: [
          { provider: "test", event_type: "tool", amount_usd: "0.001" },
        ],
      },
      usage: {
        model: "amazon.nova-pro-v1:0",
        input_tokens: 5,
        output_tokens: 7,
        cached_read_tokens: 2,
        goal_run: runResult.goalRun,
        diagnostics: {
          local_pi_timings_ms: {
            workspace_sync_ms: 12,
            sdk_prompt_ms: 34,
            total_ms: 56,
          },
        },
      },
    });
  });

  it("carries /skill-creator command metadata into the finalize payload", () => {
    const command = {
      type: "skill_creator",
      source: "slash_command",
      command: "/skill-creator",
    };

    const body = buildFinalizeBody({
      payload: {
        thread_turn_id: "turn-1",
        message: "/skill-creator create and submit a test skill",
        skill_creator_command: command,
      },
      identity,
      result: { status: "ok", runResult, latencyMs: 123 },
      fetchImpl: fetch,
    });

    expect(body).toMatchObject({
      user_message: "/skill-creator create and submit a test skill",
      skill_creator_command: command,
    });
  });
});

describe("postFinalizeCallback", () => {
  it("posts to an allowed callback URL with bearer auth", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));

    const posted = await postFinalizeCallback({
      payload: {
        finalize_callback_url: "https://api.example.com/api/threads/t/finalize",
        finalize_callback_secret: "secret",
        thread_turn_id: "turn-1",
        thinkwork_api_url: "https://api.example.com",
      },
      identity,
      result: { status: "ok", runResult, latencyMs: 1 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(posted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/api/threads/t/finalize",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });

  it("rejects cross-origin callback URLs before posting", async () => {
    const fetchImpl = vi.fn();
    const logger = vi.fn();

    const posted = await postFinalizeCallback({
      payload: {
        finalize_callback_url: "https://evil.example.com/finalize",
        finalize_callback_secret: "secret",
        thread_turn_id: "turn-1",
        thinkwork_api_url: "https://api.example.com",
      },
      identity,
      result: { status: "ok", runResult, latencyMs: 1 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger,
    });

    expect(posted).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "finalize_callback_rejected_url",
        reason: "origin-mismatch",
      }),
    );
  });
});

describe("isFinalizeCallbackConfigured", () => {
  it("requires URL, secret, and turn id", () => {
    expect(
      isFinalizeCallbackConfigured({
        finalize_callback_url: "https://api.example.com/finalize",
        finalize_callback_secret: "secret",
        thread_turn_id: "turn-1",
      }),
    ).toBe(true);
    expect(
      isFinalizeCallbackConfigured({
        finalize_callback_url: "https://api.example.com/finalize",
        finalize_callback_secret: "secret",
      }),
    ).toBe(false);
  });
});
