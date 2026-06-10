import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildAgentProfileDelegationTool,
  clarificationEscalationInstruction,
  executeAgentProfileDelegation,
  normalizeAgentProfiles,
  runAgentProfileDelegationWithClarification,
  type ProfileDelegationToolOptions,
} from "../src/agent-profile-delegation.js";
import { runParentOwnedProfileOrchestration } from "../src/server.js";
import type { AgentProfileConfig } from "../src/agent-profile-adapter.js";
import { buildMcpTools, HandleStore } from "../src/mcp.js";
import { McpToolRegistry } from "../src/mcp-registry.js";

function tool(name: string): AgentTool<any> {
  return {
    name,
    label: name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({
      content: [{ type: "text", text: `${name} result` }],
    })),
  } as unknown as AgentTool<any>;
}

async function twentyCrmTools(
  registry: McpToolRegistry,
): Promise<AgentTool<any>[]> {
  return buildMcpTools({
    mcpConfigs: [
      {
        serverName: "twenty-crm",
        url: "https://mcp.example.com",
        bearer: "token",
      },
    ],
    handleStore: new HandleStore(),
    registry,
    connectMcpServer: async (args) => {
      args.registry?.register(args.serverName, {
        tool: "find_many_opportunities",
        description: "Find opportunities",
        inputSchema: { type: "object" },
      });
      args.registry?.register(args.serverName, {
        tool: "delete_opportunity",
        description: "Delete opportunity",
        inputSchema: { type: "object" },
      });
      return [tool("find_many_opportunities"), tool("delete_opportunity")];
    },
  });
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
    instructions: "Research with sources.",
    routingGuidance: "Use this for research.",
    toolPolicy: {
      builtInTools: ["read", "web-search", "web-extract"],
      skills: ["source-review"],
      mcpServers: [
        {
          serverName: "twenty-crm",
          toolWhitelist: ["find_many_opportunities"],
        },
      ],
    },
    executionControls: {
      maxRuntimeMs: 10_000,
      maxTokens: 1_000,
    },
    contextPolicy: {
      systemPromptMode: "replace",
      inheritProjectContext: false,
      inheritSkills: false,
      defaultContext: "fresh",
    },
    ...overrides,
  };
}

async function options(
  overrides: Partial<ProfileDelegationToolOptions> = {},
): Promise<ProfileDelegationToolOptions> {
  const registry = new McpToolRegistry();
  const mcpTools = await twentyCrmTools(registry);
  return {
    profiles: [researchProfile()],
    parentThreadTurnId: "turn-parent",
    parentModelId: "anthropic/claude-sonnet-4-5",
    tools: [...mcpTools, tool("execute_code")],
    extensionFactories: [],
    extensionToolNames: ["web_search", "web_extract"],
    workspaceSkills: [
      {
        slug: "source-review",
        name: "Source Review",
        description: "Review sources",
        skillPath: "/tmp/workspace/skills/source-review/SKILL.md",
        content: "# Source Review",
      },
    ],
    mcpRegistry: registry,
    cwd: "/tmp/workspace",
    agentDir: "/tmp/pi-agent",
    threadId: "thread-1",
    gitSha: "test",
    identity: {
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
    },
    now: vi
      .fn()
      .mockReturnValueOnce(new Date("2026-06-07T12:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-06-07T12:00:01.000Z")),
    ...overrides,
  };
}

describe("agent profile delegation", () => {
  it("normalizes runtime payload profiles into adapter configs", () => {
    expect(
      normalizeAgentProfiles([
        {
          id: "p1",
          slug: "research",
          name: "Research",
          modelId: "anthropic/claude-haiku-4-5",
          builtInKey: "research",
          instructions: "Research.",
          routingGuidance: "Use for research.",
          builtInTools: ["web_search"],
          skillSlugs: ["source-review"],
          mcpServers: [
            {
              name: "twenty-crm",
              allowedTools: ["find_many_opportunities"],
            },
          ],
          executionControls: {
            maxRuntimeMs: 5000,
            maxTokens: 500,
            thinking: "low",
            reviewGate: true,
            maxReviewLoops: 2,
            loopPolicy: {
              mode: "closed",
              enabled: true,
              maxIterations: 2,
              maxReviewLoops: 2,
              reviewGate: true,
              externalReviewerPolicy: "profile_required",
              failBehavior: "best_effort_with_warning",
            },
          },
        },
      ]),
    ).toMatchObject([
      {
        id: "p1",
        slug: "research",
        modelId: "anthropic/claude-haiku-4-5",
        toolPolicy: {
          builtInTools: ["web_search"],
          skills: ["source-review"],
          mcpServers: [
            {
              serverName: "twenty-crm",
              toolWhitelist: ["find_many_opportunities"],
            },
          ],
        },
        executionControls: expect.objectContaining({
          maxRuntimeMs: 5000,
          maxTokens: 500,
          thinking: "low",
          reviewGate: true,
          maxReviewLoops: 2,
          loopPolicy: {
            mode: "closed",
            enabled: true,
            maxIterations: 2,
            maxReviewLoops: 2,
            reviewGate: true,
            externalReviewerPolicy: "profile_required",
            failBehavior: "best_effort_with_warning",
          },
        }),
      },
    ]);
  });

  it("runs a profile child loop with the profile model and narrowed tools", async () => {
    let captured:
      | Parameters<NonNullable<ProfileDelegationToolOptions["runLoop"]>>[0]
      | undefined;
    const runLoop = vi.fn(async (args) => {
      captured = args;
      return {
        content: "Research handoff",
        modelId: String(args.modelId),
        toolsCalled: ["web_search", "find_many_opportunities"],
        toolInvocations: [],
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        toolCosts: [],
      };
    });

    const evidence = await executeAgentProfileDelegation({
      options: await options({ runLoop }),
      profileSlug: "research",
      task: "Find current sources",
    });

    expect(runLoop).toHaveBeenCalledTimes(1);
    expect(captured?.modelId).toBe("anthropic/claude-haiku-4-5");
    expect(captured?.builtinToolNames).toEqual(["read"]);
    expect(captured?.extensionToolNames).toEqual(["web_search", "web_extract"]);
    expect(captured?.tools.map((item) => item.name)).toEqual([
      "find_many_opportunities",
    ]);
    expect(captured?.tools.map((item) => item.name)).not.toContain(
      "delete_opportunity",
    );
    expect(captured?.tools.map((item) => item.name)).not.toContain(
      "execute_code",
    );
    expect(captured?.systemPrompt).toContain("Research with sources.");
    expect(captured?.systemPrompt).toContain("Discovery");
    expect(captured?.systemPrompt).toContain("Planning");
    expect(captured?.systemPrompt).toContain("Execution");
    expect(captured?.systemPrompt).toContain("Verification");
    expect(captured?.systemPrompt).toContain("internal Verifier/Reviewer");
    expect(captured?.systemPrompt).toContain("Iteration");
    expect(captured?.systemPrompt).toContain("Handoff");
    expect(captured?.systemPrompt).toContain("Review gate: required");
    expect(captured?.systemPrompt).toContain("Verdict: pass | revise | fail");
    expect(captured?.systemPrompt).toContain(
      "A verifier verdict is required for every Agent Profile run",
    );
    expect(captured?.systemPrompt).toContain(
      "The parent Agent owns the final user-facing response",
    );
    expect(captured?.systemPrompt).toContain(
      "Do not reveal private reasoning or chain-of-thought",
    );
    expect(captured?.systemPrompt).toContain("Max iterations: 1");
    expect(evidence).toMatchObject({
      profileSlug: "research",
      model: "anthropic/claude-haiku-4-5",
      status: "completed",
      handoffSummary: "Research handoff",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it("passes bounded parent conversation history into profile child loops", async () => {
    let captured:
      | Parameters<NonNullable<ProfileDelegationToolOptions["runLoop"]>>[0]
      | undefined;
    const parentHistory: NonNullable<
      ProfileDelegationToolOptions["parentHistory"]
    > = [
      {
        role: "user",
        content: "Find the current CEO of Stripe and cite one source.",
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Patrick Collison is the CEO of Stripe. Source: stripe.com.",
          },
        ],
        api: "bedrock-converse-stream",
        provider: "amazon-bedrock",
        model: "anthropic/claude-sonnet-4-5",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "stop",
        timestamp: 2,
      },
    ];
    const runLoop = vi.fn(async (args) => {
      captured = args;
      return {
        content: "Review handoff",
        modelId: String(args.modelId),
        toolsCalled: [],
        toolInvocations: [],
        toolCosts: [],
      };
    });

    await executeAgentProfileDelegation({
      options: await options({ runLoop, parentHistory }),
      profileSlug: "research",
      task: "Review the previous answer for accuracy.",
    });

    expect(captured?.history).toEqual(parentHistory);
  });

  it("passes inherited attachment context and allowed file tools to profile child loops", async () => {
    let captured:
      | Parameters<NonNullable<ProfileDelegationToolOptions["runLoop"]>>[0]
      | undefined;
    const runLoop = vi.fn(async (args) => {
      captured = args;
      return {
        content: "Budget handoff",
        modelId: String(args.modelId),
        toolsCalled: ["file_read", "execute_code"],
        toolInvocations: [],
        toolCosts: [],
      };
    });

    await executeAgentProfileDelegation({
      options: await options({
        profiles: [
          researchProfile({
            slug: "analyst",
            name: "Analyst",
            builtInKey: "analyst",
            toolPolicy: {
              builtInTools: ["file_read", "execute_code"],
            },
          }),
        ],
        tools: [tool("file_read"), tool("execute_code")],
        contextPreamble: [
          "Files attached to this turn:",
          "- /tmp/pi-turn-test/attachments/Budget-Forecast.xlsx",
          "Use the `file_read` tool with one of the absolute paths above.",
        ].join("\n"),
        runLoop,
      }),
      profileSlug: "analyst",
      task: "Review the attached budget forecast.",
    });

    expect(captured?.tools.map((item) => item.name)).toEqual([
      "file_read",
      "execute_code",
    ]);
    expect(captured?.systemPrompt).toContain("Inherited parent turn context:");
    expect(captured?.systemPrompt).toContain("Files attached to this turn:");
    expect(captured?.systemPrompt).toContain(
      "/tmp/pi-turn-test/attachments/Budget-Forecast.xlsx",
    );
  });

  it("emits profile start, child tool, and completion activity with lane metadata", async () => {
    let emitChildActivity: unknown;
    const emitted: Array<{
      eventType: string;
      message: string;
      payload?: unknown;
    }> = [];
    const runLoop = vi.fn(async (_args, deps) => {
      emitChildActivity = deps?.emitActivity;
      deps?.emitActivity?.({
        eventType: "tool_invocation_started",
        message: "web_search",
        stream: "step",
        payload: {
          tool_name: "web_search",
          input_preview: "Stripe CEO",
        },
      });
      return {
        content: "Research handoff",
        modelId: "anthropic/claude-haiku-4-5",
        toolsCalled: ["web_search"],
        toolInvocations: [],
        toolCosts: [],
      };
    });

    await executeAgentProfileDelegation({
      options: await options({
        runLoop,
        emitActivity: (event) => emitted.push(event),
      }),
      profileSlug: "research",
      task: "Find current sources",
    });

    expect(typeof emitChildActivity).toBe("function");
    expect(emitted.map((event) => event.eventType)).toEqual([
      "agent_profile_run_started",
      "tool_invocation_started",
      "agent_profile_run_completed",
    ]);
    expect(emitted[1]).toMatchObject({
      message: "Research: web_search",
      payload: {
        profile_slug: "research",
        profile_name: "Research",
        model: "anthropic/claude-haiku-4-5",
        lane_key: "profile:research",
        child_event_type: "tool_invocation_started",
        tool_name: "web_search",
      },
    });
  });

  it("preserves the customer-demo proof shape for a delegated Research run", async () => {
    const runLoop = vi.fn(async (args) => ({
      content: "Patrick Collison is the CEO of Stripe. Source: stripe.com.",
      modelId: String(args.modelId),
      toolsCalled: ["web_search", "web_extract"],
      toolInvocations: [
        {
          id: "tool-web-search",
          name: "web_search",
          tool_name: "web_search",
          args: { query: "Stripe CEO today" },
          result: { results: [{ title: "Stripe leadership" }] },
          input_preview: '{"query":"Stripe CEO today"}',
          output_preview: "Stripe leadership",
          status: "completed",
          runtime: "pi" as const,
        },
        {
          id: "tool-web-extract",
          name: "web_extract",
          tool_name: "web_extract",
          args: {
            url: "https://stripe.com/newsroom",
            authorization: "Bearer demo-secret",
          },
          result: { title: "Stripe Newsroom" },
          input_preview:
            '{"url":"https://stripe.com/newsroom","authorization":"Bearer demo-secret"}',
          output_preview: "Patrick Collison",
          status: "completed",
          runtime: "pi" as const,
        },
      ],
      usage: {
        input: 88,
        output: 24,
        cacheRead: 5_000,
        cacheWrite: 0,
        totalTokens: 112,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      toolCosts: [],
    }));

    const evidence = await executeAgentProfileDelegation({
      options: await options({ runLoop }),
      profileSlug: "research",
      task: "Search the web and cite the source for the CEO of Stripe today.",
    });

    expect(runLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Search the web and cite the source for the CEO of Stripe today.",
        modelId: "anthropic/claude-haiku-4-5",
        extensionToolNames: ["web_search", "web_extract"],
        threadId: expect.stringContaining(":profile:"),
      }),
      expect.objectContaining({
        emitActivity: expect.any(Function),
      }),
    );
    expect(evidence).toMatchObject({
      profileSlug: "research",
      profileName: "Research",
      model: "anthropic/claude-haiku-4-5",
      parentThreadTurnId: "turn-parent",
      status: "completed",
      inputTokens: 88,
      outputTokens: 24,
      cachedReadTokens: 5_000,
      totalTokens: 112,
      handoffSummary:
        "Patrick Collison is the CEO of Stripe. Source: stripe.com.",
      laneKey: "profile:research",
    });
    expect(evidence.toolInvocations.map((item) => item.tool_name)).toEqual([
      "web_search",
      "web_extract",
    ]);
    expect(JSON.stringify(evidence.toolInvocations)).toContain("[REDACTED]");
    expect(JSON.stringify(evidence.toolInvocations)).not.toContain(
      "demo-secret",
    );
  });

  it("returns first-class profile evidence from the constrained profile tool", async () => {
    const runLoop = vi.fn(async (args) => ({
      content: `handoff for ${args.message}`,
      modelId: String(args.modelId),
      toolsCalled: [],
      toolInvocations: [],
      toolCosts: [],
    }));
    const delegationTool = buildAgentProfileDelegationTool(
      await options({ runLoop }),
    );
    expect(delegationTool?.name).toBe("delegate_to_agent_profile");

    const result = await delegationTool!.execute(
      "tool-call-1",
      { profileSlug: "research", task: "Find sources" },
      undefined,
      undefined,
    );

    expect(JSON.stringify(result)).toContain("agent_profile_run");
    expect(result.details).toMatchObject({
      agentProfileRun: {
        profileSlug: "research",
        handoffSummary: "handoff for Find sources",
      },
    });
  });

  it("does not expose a raw generic subagent tool", async () => {
    const delegationTool = buildAgentProfileDelegationTool(await options());
    expect(delegationTool?.name).toBe("delegate_to_agent_profile");
    expect(delegationTool?.name).not.toBe("subagent");
    expect(
      buildAgentProfileDelegationTool(await options({ profiles: [] })),
    ).toBeNull();
  });

  it("dictates the needs_clarification handoff contract in the specialist prompt", async () => {
    let captured:
      | Parameters<NonNullable<ProfileDelegationToolOptions["runLoop"]>>[0]
      | undefined;
    const runLoop = vi.fn(async (args) => {
      captured = args;
      return {
        content: "Verdict: pass\nSummary: Done.",
        modelId: String(args.modelId),
        toolsCalled: [],
        toolInvocations: [],
        toolCosts: [],
      };
    });

    await executeAgentProfileDelegation({
      options: await options({ runLoop }),
      profileSlug: "research",
      task: "Find current sources",
    });

    expect(captured?.systemPrompt).toContain(
      "Verdict: pass | revise | fail | needs_clarification",
    );
    expect(captured?.systemPrompt).toContain(
      "hand off with Verdict: needs_clarification instead of assuming",
    );
    expect(captured?.systemPrompt).toContain(
      "surface ALL clarification needs in that one handoff (max 4 questions)",
    );
    expect(captured?.systemPrompt).toContain(
      "you get one escalation per delegation",
    );
    expect(captured?.systemPrompt).toContain(
      "Questions: required only for needs_clarification - a single-line JSON array",
    );
    expect(captured?.systemPrompt).toContain(
      'Questions: [{"question":"Which environment should this target?"',
    );
  });
});

// ---------------------------------------------------------------------------
// needs_clarification escalation (plan 2026-06-09-005 U6).
// ---------------------------------------------------------------------------

const CLARIFY_CONTENT = [
  "Verdict: needs_clarification",
  "Summary: The market scope changes the outcome.",
  'Questions: [{"question":"Which market?","header":"Market","options":[{"label":"US (Recommended)","description":"Fastest."},{"label":"Global","description":"Slower."}]}]',
].join("\n");
const PASS_CONTENT = "Verdict: pass\nSummary: Work is done.";
const REVISE_CONTENT =
  "Verdict: revise\nSummary: Needs work.\nFeedback: Add a primary source.";

function scriptedRunLoop(contents: string[]) {
  let call = 0;
  const messages: string[] = [];
  const runLoop = vi.fn(async (args: { message: string; modelId: unknown }) => {
    messages.push(String(args.message));
    const content = contents[Math.min(call, contents.length - 1)];
    call += 1;
    return {
      content,
      modelId: String(args.modelId),
      toolsCalled: [],
      toolInvocations: [],
      toolCosts: [],
    };
  });
  return { runLoop, messages };
}

describe("needs_clarification escalation", () => {
  it("surfaces a first escalation with questions, delegation context, and the ask instruction", async () => {
    const { runLoop } = scriptedRunLoop([CLARIFY_CONTENT]);
    const outcome = await runAgentProfileDelegationWithClarification({
      options: await options({ runLoop }),
      profileSlug: "research",
      task: "Research the market",
    });

    expect(runLoop).toHaveBeenCalledTimes(1);
    expect(outcome.runs).toHaveLength(1);
    expect(outcome.clarificationConversion).toBeUndefined();
    expect(outcome.clarification).toMatchObject({
      profileSlug: "research",
      profileName: "Research",
      task: "Research the market",
      escalationCount: 1,
    });
    expect(outcome.clarification?.questions).toEqual([
      {
        question: "Which market?",
        header: "Market",
        options: [
          { label: "US (Recommended)", description: "Fastest." },
          { label: "Global", description: "Slower." },
        ],
      },
    ]);
    // Status maps to the clarification analog, never failed.
    expect(outcome.evidence.loopEvidence?.goalState).toMatchObject({
      status: "clarification_requested",
    });
    expect(outcome.evidence.status).toBe("completed");

    const instruction = clarificationEscalationInstruction(
      outcome.clarification!,
    );
    expect(instruction).toContain("ask_user_question");
    expect(instruction).toContain("re-delegate");
    expect(instruction).toContain('"profileSlug":"research"');
    expect(instruction).toContain('"originalTask":"Research the market"');
    expect(instruction).toContain('"escalationCount":1');
  });

  it("converts a re-escalation (escalationCount >= 1) to a best-judgment re-invoke with no ask", async () => {
    const { runLoop, messages } = scriptedRunLoop([
      CLARIFY_CONTENT,
      PASS_CONTENT,
    ]);
    const outcome = await runAgentProfileDelegationWithClarification({
      options: await options({
        runLoop,
        resumeDelegationContext: {
          profileSlug: "research",
          originalTask: "Research the market",
          escalationCount: 1,
        },
      }),
      profileSlug: "research",
      task: "Research the market\n\nUser answers: US only.",
    });

    expect(runLoop).toHaveBeenCalledTimes(2);
    expect(messages[1]).toContain("proceed on your best judgment");
    expect(messages[1]).toContain("Which market?");
    expect(messages[1]).toContain("Do not hand off needs_clarification again");
    expect(outcome.clarification).toBeUndefined();
    expect(outcome.clarificationConversion).toBe("escalation_budget");
    expect(outcome.clarificationBestEffort).toBeUndefined();
    expect(outcome.runs).toHaveLength(2);
    expect(outcome.evidence.handoff?.verdict).toBe("pass");
  });

  it("keeps a separate escalation for a different task delegated to the same profile", async () => {
    const { runLoop } = scriptedRunLoop([CLARIFY_CONTENT]);
    const outcome = await runAgentProfileDelegationWithClarification({
      options: await options({
        runLoop,
        resumeDelegationContext: {
          profileSlug: "research",
          originalTask: "Plan the product launch",
          escalationCount: 1,
        },
      }),
      profileSlug: "research",
      task: "Research the market",
    });

    expect(runLoop).toHaveBeenCalledTimes(1);
    expect(outcome.clarification).toMatchObject({ escalationCount: 1 });
    expect(outcome.clarificationConversion).toBeUndefined();
  });

  it("eval mode converts immediately; a second needs_clarification is best-effort, not a third invoke", async () => {
    const { runLoop, messages } = scriptedRunLoop([
      CLARIFY_CONTENT,
      CLARIFY_CONTENT,
    ]);
    const outcome = await runAgentProfileDelegationWithClarification({
      options: await options({ runLoop, evalMode: true }),
      profileSlug: "research",
      task: "Research the market",
    });

    expect(runLoop).toHaveBeenCalledTimes(2);
    expect(messages[1]).toContain("proceed on your best judgment");
    expect(outcome.clarification).toBeUndefined();
    expect(outcome.clarificationConversion).toBe("eval_mode");
    expect(outcome.clarificationBestEffort).toBe(true);
    expect(outcome.runs).toHaveLength(2);
  });

  it("surfaces the escalation through the delegation tool result", async () => {
    const { runLoop } = scriptedRunLoop([CLARIFY_CONTENT]);
    const delegationTool = buildAgentProfileDelegationTool(
      await options({ runLoop }),
    );

    const result = await delegationTool!.execute(
      "tool-call-1",
      { profileSlug: "research", task: "Find sources" },
      undefined,
      undefined,
    );

    const body = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text,
    );
    expect(body.needs_clarification).toMatchObject({
      delegation_context: {
        profileSlug: "research",
        originalTask: "Find sources",
        escalationCount: 1,
      },
    });
    expect(body.needs_clarification.questions).toHaveLength(1);
    expect(body.needs_clarification.instruction).toContain("ask_user_question");
    expect(body.needs_clarification.instruction).toContain("delegationContext");
  });

  it("notes best-effort output in the tool result after a converted re-escalation clarifies again", async () => {
    const { runLoop } = scriptedRunLoop([CLARIFY_CONTENT, CLARIFY_CONTENT]);
    const delegationTool = buildAgentProfileDelegationTool(
      await options({ runLoop, evalMode: true }),
    );

    const result = await delegationTool!.execute(
      "tool-call-1",
      { profileSlug: "research", task: "Find sources" },
      undefined,
      undefined,
    );

    const body = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text,
    );
    expect(body.needs_clarification).toBeUndefined();
    expect(body.clarification_conversion).toBe("eval_mode");
    expect(body.clarification_note).toContain("best-effort");
  });
});

describe("parent-owned orchestration clarification unwind", () => {
  function reviewerProfile(): AgentProfileConfig {
    return researchProfile({
      id: "profile-reviewer",
      slug: "reviewer",
      name: "Reviewer",
      builtInKey: "reviewer",
    });
  }

  async function orchestrate(input: {
    contents: string[];
    optionsOverrides?: Partial<ProfileDelegationToolOptions>;
    profiles?: AgentProfileConfig[];
  }) {
    const { runLoop, messages } = scriptedRunLoop(input.contents);
    const profiles = input.profiles ?? [researchProfile(), reviewerProfile()];
    const delegationOptions = await options({
      runLoop,
      profiles,
      now: undefined,
      ...input.optionsOverrides,
    });
    const result = await runParentOwnedProfileOrchestration({
      originalMessage: "@Research @Reviewer research the market",
      baseTask: "research the market",
      requestedProfiles: profiles,
      profileDelegationOptions: delegationOptions,
      parentRunInput: {
        message: "(caller message; orchestration owns the parent prompt)",
        history: [],
        tools: [],
        modelId: "anthropic/claude-sonnet-4-5",
        threadId: "thread-1",
        gitSha: "test",
      },
      runLoop: runLoop as never,
      log: () => {},
      emitActivity: () => {},
      wrapParentMessage: (message) => `WRAPPED\n\n${message}`,
    });
    return { result, runLoop, messages };
  }

  it("unwinds the chain on needs_clarification and instructs the parent", async () => {
    const { result, runLoop, messages } = await orchestrate({
      contents: [CLARIFY_CONTENT, "parent final response"],
    });

    // Research clarified -> reviewer never ran; only the parent loop follows.
    expect(runLoop).toHaveBeenCalledTimes(2);
    const parentMessage = messages[1];
    expect(parentMessage.startsWith("WRAPPED")).toBe(true);
    expect(parentMessage).toContain("needs clarification");
    expect(parentMessage).toContain("Which market?");
    expect(parentMessage).toContain("ask_user_question");
    expect(parentMessage).toContain('"profileSlug":"research"');
    expect(parentMessage).toContain('"originalTask":"research the market"');
    expect(parentMessage).toContain('"escalationCount":1');
    expect(result.agentProfileRuns).toHaveLength(1);
    expect(result.agentProfileRuns?.[0]?.handoff?.verdict).toBe(
      "needs_clarification",
    );
  });

  it("does not consume the reviewLoops budget on a clarification conversion", async () => {
    const { runLoop, messages, result } = await (async () => {
      // Call order: research(clarify->converted), research(best-judgment),
      // reviewer(revise), research(retry), reviewer(pass), parent.
      return orchestrate({
        contents: [
          CLARIFY_CONTENT,
          PASS_CONTENT,
          REVISE_CONTENT,
          PASS_CONTENT,
          "Verdict: pass\nSummary: Approved.",
          "parent final response",
        ],
        optionsOverrides: { evalMode: true },
      });
    })();

    // The clarification conversion (calls 1-2) must leave the full
    // maxReviewLoops=1 budget intact: the revise cycle (calls 4-5) still runs.
    expect(runLoop).toHaveBeenCalledTimes(6);
    expect(messages[1]).toContain("proceed on your best judgment");
    expect(messages[3]).toContain("Reviewer feedback");
    expect(messages[5]).not.toContain("ask_user_question");
    expect(result.agentProfileRuns).toHaveLength(5);
  });
});
