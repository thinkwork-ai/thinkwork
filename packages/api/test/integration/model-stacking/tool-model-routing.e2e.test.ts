import { describe, expect, it, vi } from "vitest";

import {
  composeWorkspacePolicy,
  type WorkspaceModelRoutingSource,
} from "../../../src/lib/workspace-renderer/effective-policy-composer.js";
import { parseToolsMdPolicy } from "../../../src/lib/workspace-renderer/tools-md-parser.js";

const PARENT_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const AGENT_MODEL = "us.amazon.nova-micro-v1:0";
const SPACE_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const USER_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const UNAPPROVED_MODEL = "us.anthropic.claude-opus-4-5-20251001-v1:0";
const SKILL_SLUG = "financial-analysis";

interface ToolDefinitionLike {
  name: string;
  execute: (...args: unknown[]) => Promise<{
    content?: Array<{ type?: string; text?: string }>;
    details?: unknown;
  }>;
}

interface AgentSessionLike {
  subscribe(fn: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  readonly messages: unknown[];
  dispose(): void;
}

interface RunAgentLoopArgsLike {
  message: string;
  history: unknown[];
  systemPrompt: string;
  tools: unknown[];
  modelId: string;
  threadId: string;
  gitSha: string;
}

interface WorkspaceSkillLike {
  slug: string;
  name: string;
  description: string;
  skillPath: string;
  content: string;
}

async function loadPiModules() {
  const defineExtensionPath =
    "../../../../pi-extensions/src/define-extension.js";
  const skillsPath = "../../../../pi-extensions/src/skills.js";
  const agentLoopPath = "../../../../pi-runtime-core/src/agent-loop.js";
  const [{ toExtensionFactory }, { createSkillsExtension }, { runAgentLoop }] =
    await Promise.all([
      import(defineExtensionPath),
      import(skillsPath),
      import(agentLoopPath),
    ]);
  return { createSkillsExtension, runAgentLoop, toExtensionFactory };
}

const financialAnalysisSkill: WorkspaceSkillLike = {
  slug: SKILL_SLUG,
  name: "Financial Analysis",
  description: "Analyze financial context and return a concise finding.",
  skillPath: "/workspace/skills/financial-analysis/SKILL.md",
  content: [
    "# Financial Analysis",
    "",
    "Compare the supplied revenue notes and identify the margin risk.",
  ].join("\n"),
};

function toolsMd(model: string, reason: string): string {
  return `---
modelRouting:
  - tool: workspace_skill
    match:
      slug: ${SKILL_SLUG}
    model: ${model}
    reason: ${reason}
---
# Tools
`;
}

function sourceFromToolsMd(input: {
  owner: WorkspaceModelRoutingSource["owner"];
  sourcePath: string;
  precedence: number;
  content: string;
}): WorkspaceModelRoutingSource {
  const parsed = parseToolsMdPolicy(input.content, { path: input.sourcePath });
  return {
    owner: input.owner,
    sourcePath: input.sourcePath,
    precedence: input.precedence,
    routes: parsed.modelRouting,
    diagnostics: parsed.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

function composeLayeredPolicy(
  overrides: Partial<{
    includeSpace: boolean;
    includeUser: boolean;
    userModel: string;
  }> = {},
) {
  const includeSpace = overrides.includeSpace ?? true;
  const includeUser = overrides.includeUser ?? true;
  const sources: WorkspaceModelRoutingSource[] = [
    sourceFromToolsMd({
      owner: "agent",
      sourcePath: "TOOLS.md",
      precedence: 10,
      content: toolsMd(AGENT_MODEL, "agent baseline cheap pass"),
    }),
  ];
  if (includeSpace) {
    sources.push(
      sourceFromToolsMd({
        owner: "space",
        sourcePath: "Spaces/board-pack/TOOLS.md",
        precedence: 20,
        content: toolsMd(SPACE_MODEL, "space board-pack override"),
      }),
    );
  }
  if (includeUser) {
    sources.push(
      sourceFromToolsMd({
        owner: "user",
        sourcePath: "User/TOOLS.md",
        precedence: 40,
        content: toolsMd(
          overrides.userModel ?? USER_MODEL,
          "user demo override wins",
        ),
      }),
    );
  }
  return composeWorkspacePolicy({ modelRoutingSources: sources });
}

function makeFakeApi() {
  const tools: ToolDefinitionLike[] = [];
  const api = {
    registerTool: (tool: ToolDefinitionLike) => tools.push(tool),
    on: vi.fn(),
  };
  return { api, tools };
}

function toolByName(
  tools: ToolDefinitionLike[],
  name: string,
): ToolDefinitionLike {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ${name} was not registered`);
  return tool;
}

function assistantMessage(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: {
      input: 400,
      output: 80,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 480,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function makeSessionWithWorkspaceSkillResult(
  result: unknown,
): AgentSessionLike {
  let listener: ((event: any) => void) | undefined;
  return {
    subscribe(fn: (event: unknown) => void) {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    async prompt() {
      listener?.({
        type: "tool_execution_start",
        toolCallId: "call-finance-1",
        toolName: "workspace_skill",
        args: { slug: SKILL_SLUG },
      });
      listener?.({
        type: "tool_execution_end",
        toolCallId: "call-finance-1",
        toolName: "workspace_skill",
        result,
        isError: false,
      });
    },
    get messages() {
      return [assistantMessage("The routed helper found a margin risk.")];
    },
    dispose: vi.fn(),
  } as unknown as AgentSessionLike;
}

function baseRunArgs(): RunAgentLoopArgsLike {
  return {
    message: `Use ${SKILL_SLUG} for the board packet.`,
    history: [],
    systemPrompt: "You are ThinkWork Pi.",
    tools: [],
    modelId: PARENT_MODEL,
    threadId: "thread-model-stacking-proof",
    gitSha: "model-stacking-e2e",
  };
}

function activityEvidenceFromToolInvocation(
  invocation: Record<string, unknown>,
) {
  const routing = invocation.model_routing as
    | Record<string, unknown>
    | undefined;
  return {
    tool: invocation.tool_name,
    model: routing?.model,
    inputTokens: routing?.inputTokens,
    outputTokens: routing?.outputTokens,
    status: routing?.status,
    ruleSource: routing?.ruleSource,
    match: routing?.match,
  };
}

describe("model stacking layered TOOLS.md proof", () => {
  it("applies agent, Space, and user TOOLS.md precedence before routing workspace_skill through the child model", async () => {
    const { createSkillsExtension, runAgentLoop, toExtensionFactory } =
      await loadPiModules();

    expect(
      composeLayeredPolicy({ includeSpace: false, includeUser: false })
        .modelRouting[0],
    ).toMatchObject({
      model: AGENT_MODEL,
      sourceOwner: "agent",
      sourcePath: "TOOLS.md",
    });
    expect(
      composeLayeredPolicy({ includeUser: false }).modelRouting[0],
    ).toMatchObject({
      model: SPACE_MODEL,
      sourceOwner: "space",
      sourcePath: "Spaces/board-pack/TOOLS.md",
    });

    const effectivePolicy = composeLayeredPolicy();
    expect(effectivePolicy.modelRouting).toEqual([
      expect.objectContaining({
        tool: "workspace_skill",
        match: { slug: SKILL_SLUG },
        model: USER_MODEL,
        sourceOwner: "user",
        sourcePath: "User/TOOLS.md",
        precedence: 40,
      }),
    ]);

    const childModelCaller = vi.fn(async () => ({
      text: "Revenue grew, but gross margin narrowed by 3 points.",
      stopReason: "end_turn",
      usage: {
        inputTokens: 1234,
        outputTokens: 56,
        cachedReadTokens: 20,
        totalTokens: 1290,
      },
    }));
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createSkillsExtension({
        skills: [financialAnalysisSkill],
        modelRoutingPolicy: { routes: effectivePolicy.modelRouting },
        approvedModelIds: [PARENT_MODEL, USER_MODEL],
        childModelCaller,
      }),
      {},
    )(api);

    const toolResult = await toolByName(tools, "workspace_skill").execute(
      "call-finance-1",
      { slug: SKILL_SLUG },
      undefined,
      undefined,
      undefined as never,
    );

    expect(childModelCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: USER_MODEL,
        metadata: expect.objectContaining({
          toolName: "workspace_skill",
          slug: SKILL_SLUG,
          sourceOwner: "user",
        }),
      }),
    );
    expect(toolResult.details).toMatchObject({
      slug: SKILL_SLUG,
      modelRouting: {
        toolName: "workspace_skill",
        match: { slug: SKILL_SLUG },
        model: USER_MODEL,
        ruleSource: {
          path: "User/TOOLS.md",
          owner: "user",
          precedence: 40,
        },
        status: "completed",
        inputTokens: 1234,
        outputTokens: 56,
        cachedReadTokens: 20,
        totalTokens: 1290,
      },
    });

    const runResult = await runAgentLoop(baseRunArgs(), {
      openSession: async () => ({
        session: makeSessionWithWorkspaceSkillResult(toolResult),
        modelId: PARENT_MODEL,
      }),
    });
    expect(runResult.modelId).toBe(PARENT_MODEL);
    expect(runResult.toolInvocations[0]).toMatchObject({
      tool_name: "workspace_skill",
      model_routing: {
        model: USER_MODEL,
        inputTokens: 1234,
        outputTokens: 56,
        ruleSource: { owner: "user" },
      },
    });
    expect(runResult.modelRoutedToolCalls).toEqual([
      runResult.toolInvocations[0].model_routing,
    ]);

    expect(
      activityEvidenceFromToolInvocation(
        runResult.toolInvocations[0] as Record<string, unknown>,
      ),
    ).toMatchObject({
      tool: "workspace_skill",
      model: USER_MODEL,
      inputTokens: 1234,
      outputTokens: 56,
      status: "completed",
      ruleSource: { owner: "user", path: "User/TOOLS.md", precedence: 40 },
      match: { slug: SKILL_SLUG },
    });
  });

  it("rejects a user-level route to an unapproved model without silently falling back", async () => {
    const { createSkillsExtension, toExtensionFactory } = await loadPiModules();

    const effectivePolicy = composeLayeredPolicy({
      userModel: UNAPPROVED_MODEL,
    });
    const { api, tools } = makeFakeApi();
    const childModelCaller = vi.fn();
    await toExtensionFactory(
      createSkillsExtension({
        skills: [financialAnalysisSkill],
        modelRoutingPolicy: { routes: effectivePolicy.modelRouting },
        approvedModelIds: [PARENT_MODEL, SPACE_MODEL],
        childModelCaller,
      }),
      {},
    )(api);

    await expect(
      toolByName(tools, "workspace_skill").execute(
        "call-finance-2",
        { slug: SKILL_SLUG },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow(/not approved/);

    expect(childModelCaller).not.toHaveBeenCalled();
    expect(effectivePolicy.modelRouting[0]).toMatchObject({
      model: UNAPPROVED_MODEL,
      sourceOwner: "user",
    });
  });
});
