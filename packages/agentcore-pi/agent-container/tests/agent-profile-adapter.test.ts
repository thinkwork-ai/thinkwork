import { describe, expect, it, vi } from "vitest";

import {
  AgentProfileAdapterError,
  assertProfileMcpOperationAllowed,
  buildAgentProfileLoopGoalState,
  compileAgentProfileRunRequest,
  runCompiledAgentProfile,
  sanitizeProfileToolInvocations,
  type AgentProfileConfig,
  type AgentProfileLoopCompletionVerdict,
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
      runProfile: vi.fn(
        async (): Promise<ProfileChildRunResult> => ({
          content: "Research handoff",
          status: "completed",
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          },
          costUsd: 0.001,
        }),
      ),
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
      loopPolicy: {
        mode: "closed",
        enabled: true,
        maxIterations: 1,
        maxReviewLoops: 1,
        reviewGate: true,
        externalReviewerPolicy: "explicit",
        failBehavior: "return_blocker",
        maxTokens: 2_000,
        costBudgetUsd: 0.05,
      },
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
      loopEvidence: {
        source: "thinkwork_agent_profile_loop",
        loopId: "profile-loop:profile-run-1",
        policy: {
          mode: "closed",
        },
        phases: expect.arrayContaining([
          expect.objectContaining({ phase: "discovery" }),
          expect.objectContaining({ phase: "planning" }),
          expect.objectContaining({ phase: "execution" }),
          expect.objectContaining({ phase: "verification" }),
          expect.objectContaining({ phase: "iteration" }),
          expect.objectContaining({ phase: "handoff" }),
        ]),
      },
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

  it("allows the profile-assigned model while validating tools and skills against profile grants", () => {
    expect(
      compileAgentProfileRunRequest({
        profile: researchProfile({
          modelId: "anthropic/claude-opus-4-1",
        }),
        task: "Find current sources",
        parentThreadTurnId: "turn-parent",
        parentModelId: "anthropic/claude-sonnet-4-5",
        availableToolNames: ["web_search", "web_extract", "read"],
        availableSkillNames: ["source-review"],
        mcpRegistry: registryWithTwentyTools(),
      }).model,
    ).toBe("anthropic/claude-opus-4-1");

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
          availableToolNames: ["web_search"],
          availableSkillNames: [],
          mcpRegistry: registryWithTwentyTools(),
        }),
      "TOOL_NOT_AVAILABLE",
    );
  });

  it("drops optional ephemeral file_read when no turn attachment injected it", () => {
    const request = compileAgentProfileRunRequest({
      profile: researchProfile({
        toolPolicy: {
          builtInTools: ["execute_code", "file_read"],
        },
      }),
      task: "Analyze this spreadsheet.",
      parentThreadTurnId: "turn-parent",
      parentModelId: "anthropic/claude-sonnet-4-5",
      availableToolNames: ["execute_code"],
      availableSkillNames: [],
      mcpRegistry: registryWithTwentyTools(),
    });

    expect(request.tools).toEqual(["execute_code"]);
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

  it("builds a ThinkWork-owned loop goal state before package continuation is used", () => {
    const request = compile({
      executionControls: {
        thinking: "low",
        maxRuntimeMs: 45_000,
        maxTokens: 4_000,
        costBudgetUsd: 0.12,
        reviewGate: true,
        maxReviewLoops: 2,
        loopPolicy: {
          mode: "closed",
          enabled: true,
          maxIterations: 2,
          maxReviewLoops: 2,
          reviewGate: true,
          externalReviewerPolicy: "explicit",
          failBehavior: "return_blocker",
          maxRuntimeMs: 45_000,
          maxTokens: 4_000,
          costBudgetUsd: 0.12,
        },
      },
    });

    const goal = buildAgentProfileLoopGoalState({
      request,
      now: () => new Date("2026-06-08T12:00:00.000Z"),
    });

    expect(goal).toMatchObject({
      source: "thinkwork_agent_profile_loop",
      goalId: "profile-loop:profile-run-1",
      objective: "Find current sources",
      parentThreadTurnId: "turn-parent",
      status: "active",
      owner: {
        type: "profile",
        profileSlug: "research",
        profileName: "Research",
      },
      budget: {
        maxIterations: 2,
        maxReviewLoops: 2,
        maxRuntimeMs: 45_000,
        maxTokens: 4_000,
        costBudgetUsd: 0.12,
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      usageByModel: {},
      continuation: {
        mode: "thinkwork_managed",
        hiddenContinuationAllowed: false,
      },
    });
  });

  it("captures loop completion verdict, usage, model breakdown, and budget-limited status", async () => {
    const request = compile({
      executionControls: {
        maxTokens: 4_000,
        costBudgetUsd: 0.12,
        loopPolicy: {
          mode: "closed",
          enabled: true,
          maxIterations: 2,
          maxReviewLoops: 1,
          reviewGate: true,
          externalReviewerPolicy: "explicit",
          failBehavior: "return_blocker",
          maxTokens: 4_000,
          costBudgetUsd: 0.12,
        },
      },
    });
    const evidence = await runCompiledAgentProfile({
      request,
      runner: {
        runProfile: async () => ({
          content: "Candidate needs one stronger source.",
          status: "completed",
          usage: {
            inputTokens: 1_200,
            outputTokens: 140,
            cachedReadTokens: 300,
            cachedWriteTokens: 20,
            totalTokens: 1_660,
          },
          costUsd: 0.0034,
        }),
      },
      now: vi
        .fn()
        .mockReturnValueOnce(new Date("2026-06-08T12:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-06-08T12:00:02.500Z")),
    });

    const reviseGoal = buildAgentProfileLoopGoalState({
      request,
      evidence,
      completion: {
        verdict: "revise",
        feedback: "Find a primary source.",
        checkedAt: new Date("2026-06-08T12:00:03.000Z"),
      },
    });

    expect(reviseGoal.status).toBe("revision_requested");
    expect(reviseGoal.completion).toEqual({
      verdict: "revise",
      feedback: "Find a primary source.",
      checkedAt: "2026-06-08T12:00:03.000Z",
    });
    expect(reviseGoal.usage).toEqual({
      inputTokens: 1_200,
      outputTokens: 140,
      cachedReadTokens: 300,
      cachedWriteTokens: 20,
      totalTokens: 1_660,
      costUsd: 0.0034,
    });
    expect(reviseGoal.usageByModel).toEqual({
      "anthropic/claude-haiku-4-5": reviseGoal.usage,
    });

    const limitedEvidence = {
      ...evidence,
      status: "resource_limit_exceeded" as const,
    };
    const limitedGoal = buildAgentProfileLoopGoalState({
      request,
      evidence: limitedEvidence,
      completion: {
        verdict: "fail",
        feedback: "Token budget exhausted.",
      },
      now: () => new Date("2026-06-08T12:00:04.000Z"),
    });

    expect(limitedGoal.status).toBe("budget_limited");
    expect(limitedGoal.continuation.hiddenContinuationAllowed).toBe(false);
  });

  it.each([
    ["pass", "passed"],
    ["revise", "revision_requested"],
    ["fail", "failed"],
  ] satisfies Array<[AgentProfileLoopCompletionVerdict, string]>)(
    "captures structured %s handoff metadata on profile run evidence",
    async (verdict, expectedStatus) => {
      const request = compile({
        executionControls: {
          reviewGate: true,
          maxReviewLoops: 2,
          loopPolicy: {
            mode: "closed",
            enabled: true,
            maxIterations: 2,
            maxReviewLoops: 2,
            reviewGate: true,
            externalReviewerPolicy: "explicit",
            failBehavior: "return_blocker",
          },
        },
      });

      const evidence = await runCompiledAgentProfile({
        request,
        runner: {
          runProfile: async () => ({
            content: "Fallback handoff body",
            status: "completed",
            handoff: {
              verdict,
              summary: "Verified the delegated work.",
              confidence: "high",
              evidence: ["Checked source A", "Checked source B"],
              feedback: verdict === "pass" ? undefined : "Needs another pass.",
            },
          }),
        },
        now: vi
          .fn()
          .mockReturnValueOnce(new Date("2026-06-08T13:00:00.000Z"))
          .mockReturnValueOnce(new Date("2026-06-08T13:00:01.000Z")),
      });

      expect(evidence.handoff).toEqual({
        verdict,
        summary: "Verified the delegated work.",
        confidence: "high",
        evidence: ["Checked source A", "Checked source B"],
        ...(verdict === "pass" ? {} : { feedback: "Needs another pass." }),
      });
      expect(evidence.loopEvidence.handoff).toEqual(evidence.handoff);
      expect(evidence.loopEvidence.goalState.status).toBe(expectedStatus);
      expect(evidence.loopEvidence.goalState.completion).toMatchObject({
        verdict,
      });
      expect(evidence.loopEvidence.phases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: "verification",
            status:
              verdict === "revise"
                ? "revision_requested"
                : verdict === "fail"
                  ? "failed"
                  : "completed",
          }),
        ]),
      );
    },
  );

  it("parses labeled handoff text without exposing hidden reasoning", async () => {
    const evidence = await runCompiledAgentProfile({
      request: compile(),
      runner: {
        runProfile: async () => ({
          content: [
            "Verdict: pass",
            "Summary: The cited source supports the answer.",
            "Evidence: Source one; Source two",
            "Confidence: medium",
          ].join("\n"),
          status: "completed",
        }),
      },
      now: vi
        .fn()
        .mockReturnValueOnce(new Date("2026-06-08T13:30:00.000Z"))
        .mockReturnValueOnce(new Date("2026-06-08T13:30:01.000Z")),
    });

    expect(evidence.handoff).toEqual({
      verdict: "pass",
      summary: "The cited source supports the answer.",
      evidence: ["Source one", "Source two"],
      confidence: "medium",
    });
    expect(JSON.stringify(evidence.loopEvidence)).not.toContain(
      "chain-of-thought",
    );
  });
});
