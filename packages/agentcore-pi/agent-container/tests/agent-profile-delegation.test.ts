import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildAgentProfileDelegationTool,
  executeAgentProfileDelegation,
  normalizeAgentProfiles,
  type ProfileDelegationToolOptions,
} from "../src/agent-profile-delegation.js";
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
    approvedModelIds: [
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-haiku-4-5",
    ],
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

  it("emits profile start, child tool, and completion activity with lane metadata", async () => {
    let emitChildActivity: unknown;
    const emitted: Array<{ eventType: string; message: string; payload?: unknown }> =
      [];
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
});
