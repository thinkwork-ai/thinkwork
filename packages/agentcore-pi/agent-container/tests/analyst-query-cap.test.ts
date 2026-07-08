/**
 * Analyst in-loop query cap + sandbox result-landing tests (THINK-228 U6).
 *
 * The allowlist-trap test runs first per the plan's execution note: a
 * delegated analyst child session must actually see run_query in its
 * tool surface — grant names are matched on the connector SLUG (the MCP
 * runtime config name), and matching on the display name silently drops
 * every granted tool.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  normalizeAgentProfiles,
  type ProfileDelegationToolOptions,
} from "../src/agent-profile-delegation.js";
import {
  createAnalystQueryCapState,
  landResultFile,
  wrapAnalystQueryTools,
  AnalystQueryCapError,
  DEFAULT_MAX_QUERIES_PER_RUN,
} from "../src/analyst-query-cap.js";
import { buildMcpTools, HandleStore } from "../src/mcp.js";
import { McpToolRegistry } from "../src/mcp-registry.js";
import type {
  RunAgentLoopArgs,
  RunAgentLoopResult,
} from "@thinkwork/pi-runtime-core";

const TMP_ROOT = mkdtempSync(path.join(tmpdir(), "analyst-cap-test-"));
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

const RUN_QUERY_ENVELOPE = {
  columns: [{ name: "n", pg_type: "int8" }],
  rows: [[42]],
  row_count: 1,
  truncated: false,
  stats: { n: { nulls: 0, min: 42, max: 42 } },
  result_file: null,
};

async function analystMcpTools(
  registry: McpToolRegistry,
  executeImpl?: () => Promise<{
    content: Array<{ type: string; text: string }>;
  }>,
): Promise<AgentTool<any>[]> {
  return buildMcpTools({
    mcpConfigs: [
      {
        // The runtime MCP config name is the connector SLUG
        // (resolve-agent-runtime-config sets name = slug ?? name).
        serverName: "postgres-dev",
        url: "https://api.example.com/mcp/analyst",
        bearer: "broker-token",
      },
    ],
    handleStore: new HandleStore(),
    registry,
    connectMcpServer: async (args) => {
      args.registry?.register(args.serverName, {
        tool: "run_query",
        description: "Run one SQL statement",
        inputSchema: { type: "object" },
      });
      const runQuery: AgentTool<any> = {
        name: "run_query",
        label: "run_query",
        description: "Run one SQL statement",
        parameters: { type: "object", properties: {} },
        execute: vi.fn(
          executeImpl ??
            (async () => ({
              content: [
                { type: "text", text: JSON.stringify(RUN_QUERY_ENVELOPE) },
              ],
            })),
        ),
      } as unknown as AgentTool<any>;
      return [runQuery];
    },
  });
}

function analystProfile(
  overrides: Partial<AgentProfileConfig> = {},
): AgentProfileConfig {
  return {
    id: "profile-analyst",
    slug: "analyst",
    name: "Analyst",
    enabled: true,
    builtInKey: "analyst",
    modelId: "anthropic/claude-sonnet-4-5",
    instructions: "Analyze data.",
    toolPolicy: {
      builtInTools: ["execute_code", "file_read"],
      mcpServers: [
        { serverName: "postgres-dev", toolWhitelist: ["run_query"] },
      ],
    },
    executionControls: { maxQueriesPerRun: 3 },
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
  executeImpl?: () => Promise<{
    content: Array<{ type: string; text: string }>;
  }>,
): Promise<{
  options: ProfileDelegationToolOptions;
  registry: McpToolRegistry;
  mcpTools: AgentTool<any>[];
}> {
  const registry = new McpToolRegistry();
  const mcpTools = await analystMcpTools(registry, executeImpl);
  const options: ProfileDelegationToolOptions = {
    profiles: [analystProfile()],
    parentThreadTurnId: "turn-parent",
    parentModelId: "anthropic/claude-sonnet-4-5",
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
  return { options, registry, mcpTools };
}

function compiled(options: ProfileDelegationToolOptions) {
  return compileAgentProfileRunRequest({
    profile: options.profiles[0]!,
    task: "How many threads were created this week per tenant?",
    parentThreadTurnId: "turn-parent",
    parentModelId: options.parentModelId,
    availableToolNames: ["execute_code", "file_read"],
    availableSkillNames: [],
    mcpRegistry: options.mcpRegistry,
  });
}

describe("allowlist trap (plan execution note — written first)", () => {
  it("a delegated analyst child session actually sees run_query in its tool surface", async () => {
    let seenTools: string[] = [];
    const { options } = await delegationOptions(async (args) => {
      seenTools = (args.tools ?? []).map((t) => t.name);
      return { content: "done" } as RunAgentLoopResult;
    });
    const runner = createProfileChildRunner(options);
    await runner.runProfile(compiled(options));
    expect(seenTools).toContain("run_query");
  });

  it("normalizeAgentProfiles matches grants on the connector slug, not the display name", () => {
    const [profile] = normalizeAgentProfiles([
      {
        id: "p1",
        slug: "analyst",
        name: "Analyst",
        modelId: "m",
        instructions: "x",
        mcpServers: [
          {
            // Runtime payload shape: display name + slug + allowedTools.
            name: "Postgres (dev)",
            slug: "postgres-dev",
            allowedTools: ["run_query"],
          },
        ],
        executionControls: { maxQueriesPerRun: 5 },
      },
    ]);
    expect(profile!.toolPolicy?.mcpServers).toEqual([
      { serverName: "postgres-dev", toolWhitelist: ["run_query"] },
    ]);
    expect(profile!.executionControls?.maxQueriesPerRun).toBe(5);
  });

  it("fail-closed: no grant → run_query absent from the child surface", async () => {
    let seenTools: string[] = [];
    const { options } = await delegationOptions(async (args) => {
      seenTools = (args.tools ?? []).map((t) => t.name);
      return { content: "done" } as RunAgentLoopResult;
    });
    options.profiles = [
      analystProfile({ toolPolicy: { builtInTools: ["execute_code"] } }),
    ];
    const runner = createProfileChildRunner(options);
    await runner.runProfile(compiled(options));
    expect(seenTools).not.toContain("run_query");
  });
});

describe("in-loop query cap (KTD3, AE5)", () => {
  it("calls 1..N succeed; the (N+1)th is refused and the delegation ends Verdict: fail", async () => {
    // Simulate the SDK loop: the model keeps calling run_query; tool
    // throws are converted to error results and the loop keeps going —
    // exactly the path a model could try to talk its way past.
    const innerExecute = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify(RUN_QUERY_ENVELOPE) }],
    }));
    const { options } = await delegationOptions(async (args) => {
      const runQuery = (args.tools ?? []).find((t) => t.name === "run_query")!;
      for (let i = 0; i < 5; i += 1) {
        try {
          await runQuery.execute(`call-${i}`, { sql: "SELECT 1" });
        } catch (err) {
          expect(err).toBeInstanceOf(AnalystQueryCapError);
        }
      }
      return { content: "I kept querying." } as RunAgentLoopResult;
    }, innerExecute);
    const runner = createProfileChildRunner(options);
    const result = await runner.runProfile(compiled(options));

    expect(result.status).toBe("failed");
    expect(result.error).toBe("QUERY_CAP_EXCEEDED");
    expect(result.handoff?.verdict).toBe("fail");
    expect(result.handoff?.summary).toContain("3 queries");
    // The inner tool executed exactly cap times — the loop owns the count.
    expect(innerExecute.mock.calls).toHaveLength(3);
  });

  it("a propagated cap error also ends as a structured fail, not a crash", async () => {
    const { options } = await delegationOptions(async (args) => {
      const runQuery = (args.tools ?? []).find((t) => t.name === "run_query")!;
      for (let i = 0; i < 4; i += 1) {
        await runQuery.execute(`call-${i}`, { sql: "SELECT 1" }); // 4th throws
      }
      return { content: "unreachable" } as RunAgentLoopResult;
    });
    const runner = createProfileChildRunner(options);
    const result = await runner.runProfile(compiled(options));
    expect(result.status).toBe("failed");
    expect(result.handoff?.verdict).toBe("fail");
  });

  it("defaults the cap when the profile does not set one", () => {
    const state = createAnalystQueryCapState(DEFAULT_MAX_QUERIES_PER_RUN);
    expect(state.cap).toBe(12);
  });
});

describe("sandbox result-landing (KTD2 file facet, R7/AE2)", () => {
  const fakeS3 = (csv: string) => ({
    send: vi.fn(async () => ({ Body: Buffer.from(csv) })),
  });

  it("lands a staged result into the data dir and rewrites the model-visible path", async () => {
    const dataDir = path.join(TMP_ROOT, "landing");
    const envelope = {
      ...RUN_QUERY_ENVELOPE,
      result_file: "s3://bucket/analyst-staging/tenant-1/abc.csv",
    };
    const rewritten = await landResultFile(JSON.stringify(envelope), {
      dataDir,
      s3Client: fakeS3("n\r\n42\r\n"),
    });
    const parsed = JSON.parse(rewritten) as { result_file: string };
    expect(parsed.result_file).not.toContain("s3://");
    expect(parsed.result_file.startsWith(dataDir)).toBe(true);
    expect(readFileSync(parsed.result_file, "utf-8")).toBe("n\r\n42\r\n");
  });

  it("passes through null result_file, non-envelope text, and non-staging keys", async () => {
    const dataDir = path.join(TMP_ROOT, "landing2");
    const s3 = fakeS3("x");
    const untouchedEnvelope = JSON.stringify(RUN_QUERY_ENVELOPE);
    expect(
      await landResultFile(untouchedEnvelope, { dataDir, s3Client: s3 }),
    ).toBe(untouchedEnvelope);
    expect(await landResultFile("plain text", { dataDir, s3Client: s3 })).toBe(
      "plain text",
    );
    const foreign = JSON.stringify({
      ...RUN_QUERY_ENVELOPE,
      result_file: "s3://bucket/tenants/acme/secrets.csv",
    });
    expect(await landResultFile(foreign, { dataDir, s3Client: s3 })).toBe(
      foreign,
    );
    expect(s3.send).not.toHaveBeenCalled();
  });

  it("the wrapped tool rewrites envelope content in place", async () => {
    const dataDir = path.join(TMP_ROOT, "landing3");
    const inner: AgentTool<any> = {
      name: "run_query",
      label: "run_query",
      description: "q",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...RUN_QUERY_ENVELOPE,
              result_file: "s3://bucket/analyst-staging/tenant-1/big.csv",
            }),
          },
        ],
        details: undefined,
      }),
    } as unknown as AgentTool<any>;
    // Register a fake identity by building through the real MCP path is
    // heavyweight here; wrap manually instead by reusing the registry
    // tools from the harness.
    const registry = new McpToolRegistry();
    const [mcpTool] = await analystMcpTools(
      registry,
      () => inner.execute("id", {}) as never,
    );
    const state = createAnalystQueryCapState(5);
    const [wrapped] = wrapAnalystQueryTools({
      tools: [mcpTool!],
      state,
      landing: { dataDir, s3Client: fakeS3("a,b\r\n1,2\r\n") },
    });
    const result = await wrapped!.execute("call-1", { sql: "SELECT 1" });
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text) as { result_file: string };
    expect(parsed.result_file.startsWith(dataDir)).toBe(true);
    expect(state.count).toBe(1);
  });
});
