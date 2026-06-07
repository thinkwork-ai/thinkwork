import { describe, expect, it, vi } from "vitest";

import {
  AgentProfileAdapterError,
  assertProfileMcpOperationAllowed,
  compileAgentProfileRunRequest,
  runCompiledAgentProfile,
  sanitizeProfileToolInvocations,
  type AgentProfileConfig,
  type ProfileChildRunResult,
} from "../src/agent-profile-adapter.js";
import { McpToolRegistry } from "../src/mcp-registry.js";

function registryWithTwentyTools(): McpToolRegistry {
  const registry = new McpToolRegistry();
  registry.register("twenty-crm", {
    tool: "find_many_opportunities",
    description: "List opportunities",
    inputSchema: { type: "object" },
  });
  registry.register("twenty-crm", {
    tool: "delete_opportunity",
    description: "Delete an opportunity",
    inputSchema: { type: "object" },
  });
  return registry;
}

function researchProfile(
  overrides: Partial<AgentProfileConfig> = {},
): AgentProfileConfig {
  return {
    id: "profile-research",
    slug: "research",
    name: "Research",
    enabled: true,
    builtInKey: "research",
    modelId: "anthropic/claude-haiku-4-5",
    fallbackModelIds: ["openai/gpt-5-mini"],
    instructions: "Research with sources.",
    routingGuidance: "Use this profile for current information.",
    toolPolicy: {
      defaultTools: ["web_search", "web_extract"],
      disabledDefaultTools: ["web_extract"],
      builtInTools: ["read"],
      skills: ["source-review"],
      mcpServers: [
        {
          serverName: "twenty-crm",
          toolWhitelist: ["find_many_opportunities"],
        },
      ],
    },
    executionControls: {
      thinking: "low",
      timeoutMs: 15_000,
      maxTokens: 2_000,
      costBudgetUsd: 0.05,
    },
    contextPolicy: {
      defaultContext: "fresh",
      inheritProjectContext: false,
      inheritSkills: false,
      systemPromptMode: "replace",
    },
    ...overrides,
  };
}

function compile(overrides: Partial<AgentProfileConfig> = {}) {
  return compileAgentProfileRunRequest({
    profile: researchProfile(overrides),
    task: "Find current sources",
    parentThreadTurnId: "turn-parent",
    parentModelId: "anthropic/claude-sonnet-4-5",
    approvedModelIds: [
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-haiku-4-5",
      "openai/gpt-5-mini",
    ],
    availableToolNames: ["web_search", "web_extract", "read"],
    availableSkillNames: ["source-review"],
    mcpRegistry: registryWithTwentyTools(),
    idFactory: () => "profile-run-1",
    now: () => new Date("2026-06-07T12:00:00.000Z"),
  });
}

function expectAdapterErrorCode(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AgentProfileAdapterError);
  expect(thrown).toMatchObject({ code });
}

describe("agent profile adapter", () => {
  it("compiles a child profile request with the explicit profile model", async () => {
    const request = compile();
    const runner = {
      runProfile: vi.fn(async (): Promise<ProfileChildRunResult> => ({
        content: "Research handoff",
        status: "completed",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
        costUsd: 0.001,
      })),
    };

    const evidence = await runCompiledAgentProfile({
      request,
      runner,
      now: vi
        .fn()
        .mockReturnValueOnce(new Date("2026-06-07T12:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-06-07T12:00:01.250Z")),
    });

    expect(request.model).toBe("anthropic/claude-haiku-4-5");
    expect(request.parentModel).toBe("anthropic/claude-sonnet-4-5");
    expect(request.fallbackModels).toEqual(["openai/gpt-5-mini"]);
    expect(request.execution).toMatchObject({
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
      timeoutMs: 15_000,
      maxTokens: 2_000,
    });
    expect(runner.runProfile).toHaveBeenCalledWith(request);
    expect(evidence).toMatchObject({
      profileRunId: "profile-run-1",
      model: "anthropic/claude-haiku-4-5",
      status: "completed",
      durationMs: 1_250,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.001,
      handoffSummary: "Research handoff",
      laneKey: "profile:research",
    });
  });

  it("rejects prompt-supplied model, tool, and skill overrides", () => {
    expectAdapterErrorCode(
      () =>
        compileAgentProfileRunRequest({
          profile: researchProfile(),
          task: "Find current sources",
          parentThreadTurnId: "turn-parent",
          parentModelId: "anthropic/claude-sonnet-4-5",
          approvedModelIds: [
            "anthropic/claude-haiku-4-5",
            "openai/gpt-5-mini",
          ],
          availableToolNames: ["web_search", "web_extract", "read"],
          availableSkillNames: ["source-review"],
          mcpRegistry: registryWithTwentyTools(),
          requestedOverrides: {
            model: "anthropic/claude-opus-4-1",
            tools: ["bash"],
            skills: ["unapproved-skill"],
          },
        }),
      "PROMPT_OVERRIDE_REJECTED",
    );
  });

  it("validates models, tools, and skills against invocation-approved sets", () => {
    expectAdapterErrorCode(
      () =>
        compileAgentProfileRunRequest({
          profile: researchProfile({
            modelId: "anthropic/claude-opus-4-1",
          }),
          task: "Find current sources",
          parentThreadTurnId: "turn-parent",
          parentModelId: "anthropic/claude-sonnet-4-5",
          approvedModelIds: [
            "anthropic/claude-haiku-4-5",
            "openai/gpt-5-mini",
          ],
          availableToolNames: ["web_search", "web_extract", "read"],
          availableSkillNames: ["source-review"],
          mcpRegistry: registryWithTwentyTools(),
        }),
      "MODEL_NOT_APPROVED",
    );

    expectAdapterErrorCode(
      () =>
        compileAgentProfileRunRequest({
          profile: researchProfile({
            toolPolicy: {
              builtInTools: ["bash"],
            },
          }),
          task: "Find current sources",
          parentThreadTurnId: "turn-parent",
          parentModelId: "anthropic/claude-sonnet-4-5",
          approvedModelIds: [
            "anthropic/claude-haiku-4-5",
            "openai/gpt-5-mini",
          ],
          availableToolNames: ["web_search"],
          availableSkillNames: [],
          mcpRegistry: registryWithTwentyTools(),
        }),
      "TOOL_NOT_AVAILABLE",
    );
  });

  it("compiles MCP server grants into operation allowlists", () => {
    const request = compile();

    expect(request.tools).toEqual(["web_search", "read"]);
    expect(request.skills).toEqual(["source-review"]);
    expect(request.mcpOperations).toEqual([
      {
        serverName: "twenty-crm",
        toolName: "find_many_opportunities",
      },
    ]);
    expect(() =>
      assertProfileMcpOperationAllowed(
        request,
        "twenty-crm",
        "find_many_opportunities",
      ),
    ).not.toThrow();
    expectAdapterErrorCode(
      () =>
        assertProfileMcpOperationAllowed(
          request,
          "twenty-crm",
          "delete_opportunity",
        ),
      "MCP_TOOL_NOT_AVAILABLE",
    );
  });

  it("normalizes timed-out, interrupted, and resource-limit evidence", async () => {
    const request = compile();
    const cases: Array<[ProfileChildRunResult, string]> = [
      [{ timedOut: true, content: "Timed out" }, "timed_out"],
      [{ interrupted: true, content: "Interrupted" }, "interrupted"],
      [
        { resourceLimitExceeded: true, content: "Too many tokens" },
        "resource_limit_exceeded",
      ],
    ];

    for (const [result, status] of cases) {
      const evidence = await runCompiledAgentProfile({
        request,
        runner: { runProfile: async () => result },
        now: () => new Date("2026-06-07T12:00:00.000Z"),
      });
      expect(evidence.status).toBe(status);
      expect(evidence.handoffSummary).toBe(result.content);
    }
  });

  it("redacts raw credentials from child tool telemetry", () => {
    const sanitized = sanitizeProfileToolInvocations([
      {
        id: "tool-1",
        name: "web_search",
        tool_name: "web_search",
        runtime: "pi",
        args: {
          apiKey: "exa-secret",
          nested: { authorization: "Bearer abc123" },
        },
        result: {
          token: "server-token",
          text: "Authorization: Bearer xyz789",
        },
        input_preview: '{"apiKey":"exa-secret"}',
        output_preview: "Authorization: Bearer xyz789",
      },
    ]);

    expect(JSON.stringify(sanitized)).not.toContain("exa-secret");
    expect(JSON.stringify(sanitized)).not.toContain("server-token");
    expect(JSON.stringify(sanitized)).not.toContain("Bearer abc123");
    expect(JSON.stringify(sanitized)).not.toContain("Bearer xyz789");
    expect(sanitized[0]?.args).toEqual({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
    });
    expect(sanitized[0]?.result).toEqual({
      token: "[REDACTED]",
      text: "Authorization: Bearer [REDACTED]",
    });
    expect(sanitized[0]?.input_preview).toBe('{"apiKey":"[REDACTED]"}');
  });
});
