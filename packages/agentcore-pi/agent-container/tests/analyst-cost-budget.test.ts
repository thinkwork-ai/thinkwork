/**
 * Analyst per-run dollar budget tests (THINK-232).
 *
 * Mirrors analyst-query-cap.test.ts conventions: the accumulator math, the
 * inert-without-budget guarantee, the exceeded flip, the wrapper charging DB
 * cost from the envelope, the fast-fail on the NEXT query, and the
 * end-of-run token-cost verdict flip through the delegation loop.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  compileAgentProfileRunRequest,
  type AgentProfileConfig,
} from "../src/agent-profile-adapter.js";
import {
  createProfileChildRunner,
  type ProfileDelegationToolOptions,
} from "../src/agent-profile-delegation.js";
import {
  AnalystCostBudgetError,
  ANALYST_DB_COST_PER_GB,
  ANALYST_DB_COST_PER_MILLION_ROWS,
  ANALYST_FALLBACK_PRICING,
  analystPricingForModel,
  createAnalystCostBudgetState,
} from "../src/analyst-cost-budget.js";
import {
  wrapAnalystQueryTools,
  createAnalystQueryCapState,
} from "../src/analyst-query-cap.js";
import { buildMcpTools, HandleStore } from "../src/mcp.js";
import { McpToolRegistry } from "../src/mcp-registry.js";
import type {
  RunAgentLoopArgs,
  RunAgentLoopResult,
} from "@thinkwork/pi-runtime-core";

const TMP_ROOT = mkdtempSync(path.join(tmpdir(), "analyst-cost-test-"));
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

const GB = 1024 * 1024 * 1024;

function envelope(rowCount: number, approxBytes: number) {
  return {
    columns: [{ name: "n", pg_type: "int8" }],
    rows: [[1]],
    row_count: rowCount,
    approx_bytes: approxBytes,
    truncated: false,
    stats: { n: { nulls: 0, min: 1, max: 1 } },
    result_file: null,
  };
}

describe("cost accumulator math (provisional rates)", () => {
  it("charges DB cost from rows and bytes at the documented rates", () => {
    const state = createAnalystCostBudgetState(10);
    // 1M rows => exactly ANALYST_DB_COST_PER_MILLION_ROWS; 1 GiB => per-GB.
    state.addQueryCost(1_000_000, GB);
    expect(state.spentUsd).toBeCloseTo(
      ANALYST_DB_COST_PER_MILLION_ROWS + ANALYST_DB_COST_PER_GB,
      10,
    );
    expect(state.exceeded).toBe(false);
  });

  it("charges token cost at the fallback per-million rates", () => {
    const state = createAnalystCostBudgetState(10);
    state.addTokenCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      ANALYST_FALLBACK_PRICING,
    );
    expect(state.spentUsd).toBeCloseTo(
      ANALYST_FALLBACK_PRICING.inputPerMillion +
        ANALYST_FALLBACK_PRICING.outputPerMillion,
      10,
    );
  });

  it("matches a model id to fallback pricing by substring, else default", () => {
    expect(analystPricingForModel("us.anthropic.claude-sonnet-4-5-x")).toEqual({
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
    });
    expect(analystPricingForModel("kimi-k2-instruct")).toEqual({
      inputPerMillion: 1.0,
      outputPerMillion: 3.0,
    });
    expect(analystPricingForModel("something-unknown")).toEqual(
      ANALYST_FALLBACK_PRICING,
    );
    expect(analystPricingForModel(undefined)).toEqual(ANALYST_FALLBACK_PRICING);
  });
});

describe("inert without a budget", () => {
  it("never accumulates or exceeds when budgetUsd is undefined", () => {
    const state = createAnalystCostBudgetState(undefined);
    state.addQueryCost(50_000_000, 100 * GB);
    state.addTokenCost(
      { inputTokens: 10_000_000, outputTokens: 10_000_000 },
      ANALYST_FALLBACK_PRICING,
    );
    expect(state.spentUsd).toBe(0);
    expect(state.exceeded).toBe(false);
  });

  it("treats a zero / non-finite budget as inert", () => {
    const zero = createAnalystCostBudgetState(0);
    zero.addQueryCost(1_000_000, GB);
    expect(zero.exceeded).toBe(false);
  });
});

describe("exceeded flip", () => {
  it("flips once accumulated spend crosses the budget", () => {
    const state = createAnalystCostBudgetState(0.05);
    // $0.05 per GB — half a GB is under budget.
    state.addQueryCost(0, GB / 2);
    expect(state.exceeded).toBe(false);
    // Another full GB pushes total to $0.075 > $0.05.
    state.addQueryCost(0, GB);
    expect(state.spentUsd).toBeGreaterThan(0.05);
    expect(state.exceeded).toBe(true);
  });
});

describe("wrapper charges DB cost from the envelope and fast-fails", () => {
  async function analystQueryTool(
    envelopes: Array<{ row_count: number; approx_bytes: number }>,
  ): Promise<{ tool: AgentTool<any>; inner: ReturnType<typeof vi.fn> }> {
    const registry = new McpToolRegistry();
    let call = 0;
    const inner = vi.fn(async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            envelope(
              envelopes[Math.min(call, envelopes.length - 1)]!.row_count,
              envelopes[call++ % envelopes.length]!.approx_bytes,
            ),
          ),
        },
      ],
    }));
    const [tool] = await buildMcpTools({
      mcpConfigs: [
        {
          serverName: "postgres-dev",
          url: "https://api.example.com/mcp/analyst",
          bearer: "broker-token",
        },
      ],
      handleStore: new HandleStore(),
      registry,
      connectMcpServer: async (args) => {
        args.registry?.register(args.serverName, {
          tool: "query",
          description: "Run one SQL statement",
          inputSchema: { type: "object" },
        });
        return [
          {
            name: "query",
            label: "query",
            description: "Run one SQL statement",
            parameters: { type: "object", properties: {} },
            execute: inner,
          } as unknown as AgentTool<any>,
        ];
      },
    });
    return { tool: tool!, inner };
  }

  it("adds query cost from row_count + approx_bytes after each call", async () => {
    const { tool } = await analystQueryTool([
      { row_count: 1_000_000, approx_bytes: GB },
    ]);
    const costBudget = createAnalystCostBudgetState(100);
    const [wrapped] = wrapAnalystQueryTools({
      tools: [tool],
      state: createAnalystQueryCapState(12),
      costBudget,
      landing: { dataDir: path.join(TMP_ROOT, "d1") },
    });
    await wrapped!.execute("c-1", { sql: "SELECT 1" });
    expect(costBudget.spentUsd).toBeCloseTo(
      ANALYST_DB_COST_PER_MILLION_ROWS + ANALYST_DB_COST_PER_GB,
      10,
    );
  });

  it("fast-fails the NEXT query once the budget is spent", async () => {
    // Each query charges ~$0.05 (1 GB). Budget $0.06: first passes and
    // trips the flip, the second must throw before executing.
    const { tool, inner } = await analystQueryTool([
      { row_count: 0, approx_bytes: 2 * GB },
    ]);
    const costBudget = createAnalystCostBudgetState(0.06);
    const [wrapped] = wrapAnalystQueryTools({
      tools: [tool],
      state: createAnalystQueryCapState(12),
      costBudget,
      landing: { dataDir: path.join(TMP_ROOT, "d2") },
    });
    await wrapped!.execute("c-1", { sql: "SELECT 1" }); // spends ~$0.10 > $0.06
    expect(costBudget.exceeded).toBe(true);
    await expect(
      wrapped!.execute("c-2", { sql: "SELECT 1" }),
    ).rejects.toBeInstanceOf(AnalystCostBudgetError);
    // The inner tool ran exactly once — the loop owns the verdict.
    expect(inner.mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end through the delegation loop: token overage flips the verdict.
// ---------------------------------------------------------------------------

function analystProfile(
  overrides: Partial<AgentProfileConfig> = {},
): AgentProfileConfig {
  return {
    id: "profile-analyst",
    slug: "analyst",
    name: "Analyst",
    enabled: true,
    builtInKey: "analyst",
    modelId: "us.anthropic.claude-sonnet-4-5",
    instructions: "Analyze data.",
    toolPolicy: {
      builtInTools: ["execute_code", "file_read"],
      mcpServers: [{ serverName: "postgres-dev", toolWhitelist: ["query"] }],
    },
    executionControls: { maxQueriesPerRun: 12, costBudgetUsd: 0.5 },
    contextPolicy: {
      systemPromptMode: "replace",
      inheritProjectContext: false,
      inheritSkills: false,
      defaultContext: "fresh",
    },
    ...overrides,
  };
}

async function delegationOptions(
  runLoop: (args: RunAgentLoopArgs) => Promise<RunAgentLoopResult>,
  profile: AgentProfileConfig,
): Promise<ProfileDelegationToolOptions> {
  const registry = new McpToolRegistry();
  const mcpTools = await buildMcpTools({
    mcpConfigs: [
      {
        serverName: "postgres-dev",
        url: "https://api.example.com/mcp/analyst",
        bearer: "broker-token",
      },
    ],
    handleStore: new HandleStore(),
    registry,
    connectMcpServer: async (args) => {
      args.registry?.register(args.serverName, {
        tool: "query",
        description: "Run one SQL statement",
        inputSchema: { type: "object" },
      });
      return [
        {
          name: "query",
          label: "query",
          description: "Run one SQL statement",
          parameters: { type: "object", properties: {} },
          execute: vi.fn(async () => ({
            content: [{ type: "text", text: JSON.stringify(envelope(1, 10)) }],
          })),
        } as unknown as AgentTool<any>,
      ];
    },
  });
  return {
    profiles: [profile],
    parentThreadTurnId: "turn-parent",
    parentModelId: "us.anthropic.claude-sonnet-4-5",
    tools: mcpTools,
    extensionFactories: [],
    extensionToolNames: ["execute_code", "file_read"],
    workspaceSkills: [],
    mcpRegistry: registry,
    cwd: TMP_ROOT,
    agentDir: TMP_ROOT,
    threadId: "thread-1",
    gitSha: "test",
    identity: { tenantId: "tenant-1", agentId: "agent-1" },
    runLoop: runLoop as never,
  };
}

function compiled(options: ProfileDelegationToolOptions) {
  return compileAgentProfileRunRequest({
    profile: options.profiles[0]!,
    task: "How many rows?",
    parentThreadTurnId: "turn-parent",
    parentModelId: options.parentModelId,
    availableToolNames: ["execute_code", "file_read"],
    availableSkillNames: [],
    mcpRegistry: options.mcpRegistry,
  });
}

describe("end-of-run token cost flips the verdict (post-hoc)", () => {
  it("a run that stays under budget completes normally", async () => {
    const options = await delegationOptions(
      async () =>
        ({
          content: "done",
          usage: { input_tokens: 1000, output_tokens: 100 },
        }) as unknown as RunAgentLoopResult,
      analystProfile({ executionControls: { costBudgetUsd: 0.5 } }),
    );
    const runner = createProfileChildRunner(options);
    const result = await runner.runProfile(compiled(options));
    expect(result.status).toBe("completed");
    expect(result.error).toBeUndefined();
  });

  it("token overage detected at run end converts to a BUDGET_EXCEEDED fail", async () => {
    // Tiny budget: 1M input + 1M output tokens at $3/$15 per M = $18 >> $0.01.
    const options = await delegationOptions(
      async () =>
        ({
          content: "I answered but burned tokens.",
          usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
        }) as unknown as RunAgentLoopResult,
      analystProfile({ executionControls: { costBudgetUsd: 0.01 } }),
    );
    const runner = createProfileChildRunner(options);
    const result = await runner.runProfile(compiled(options));
    expect(result.status).toBe("failed");
    expect(result.error).toBe("BUDGET_EXCEEDED");
    expect(result.handoff?.verdict).toBe("fail");
    expect(result.handoff?.summary).toContain("cost budget");
    expect(result.costUsd).toBeGreaterThan(0.01);
  });

  it("no budget configured → the run is never failed for cost", async () => {
    const options = await delegationOptions(
      async () =>
        ({
          content: "done",
          usage: { input_tokens: 5_000_000, output_tokens: 5_000_000 },
        }) as unknown as RunAgentLoopResult,
      analystProfile({ executionControls: { maxQueriesPerRun: 12 } }),
    );
    const runner = createProfileChildRunner(options);
    const result = await runner.runProfile(compiled(options));
    expect(result.status).toBe("completed");
  });
});
