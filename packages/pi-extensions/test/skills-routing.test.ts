import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { toExtensionFactory } from "../src/define-extension.js";
import { createSkillsExtension, type WorkspaceSkill } from "../src/skills.js";

function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: vi.fn(),
  } as unknown as ExtensionAPI;
  return { api, tools };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

const skill: WorkspaceSkill = {
  slug: "research",
  name: "Research",
  description: "Research helper",
  skillPath: "/workspace/skills/research/SKILL.md",
  content: "# Research\nUse carefully.",
};

const NO_SIGNAL = undefined;
const NO_UPDATE = undefined;
const NO_CTX = undefined as never;

describe("workspace skill model routing", () => {
  it("runs a matched workspace_skill call through the routed child model", async () => {
    const childModelCaller = vi.fn(async () => ({
      text: "routed answer",
      stopReason: "end_turn",
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
      },
    }));
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createSkillsExtension({
        skills: [skill],
        modelRoutingPolicy: {
          routes: [
            {
              tool: "workspace_skill",
              match: { slug: "research" },
              model: "us.amazon.nova-micro-v1:0",
              sourcePath: "/workspace/User/TOOLS.md",
              sourceOwner: "user",
              precedence: 300,
            },
          ],
        },
        approvedModelIds: ["us.amazon.nova-micro-v1:0"],
        childModelCaller,
      }),
      {},
    )(api);

    const result = await getTool(tools, "workspace_skill").execute(
      "call-1",
      { slug: "research" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(childModelCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "us.amazon.nova-micro-v1:0",
        metadata: expect.objectContaining({
          toolName: "workspace_skill",
          slug: "research",
          sourceOwner: "user",
        }),
      }),
    );
    expect((result.content?.[0] as { text: string }).text).toBe(
      "routed answer",
    );
    expect(result.details).toMatchObject({
      slug: "research",
      modelRouting: {
        toolName: "workspace_skill",
        match: { slug: "research" },
        model: "us.amazon.nova-micro-v1:0",
        ruleSource: {
          path: "/workspace/User/TOOLS.md",
          owner: "user",
          precedence: 300,
        },
        status: "completed",
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
      },
    });
  });

  it("rejects a matched route whose model is not approved for the user", async () => {
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createSkillsExtension({
        skills: [skill],
        modelRoutingPolicy: {
          routes: [
            {
              tool: "workspace_skill",
              match: { slug: "research" },
              model: "not-approved",
            },
          ],
        },
        approvedModelIds: ["approved"],
        childModelCaller: vi.fn(),
      }),
      {},
    )(api);

    await expect(
      getTool(tools, "workspace_skill").execute(
        "call-1",
        { slug: "research" },
        NO_SIGNAL,
        NO_UPDATE,
        NO_CTX,
      ),
    ).rejects.toThrow(/not approved/);
  });
});
