import { describe, expect, it } from "vitest";
import {
  agentProfileSlugFromWorkspacePath,
  isAgentProfileWorkspacePath,
  parseAgentProfileFile,
  serializeAgentProfileFile,
} from "./agent-profile-workspace-files.js";

describe("agent profile workspace files", () => {
  it("recognizes canonical Agent Profile markdown files", () => {
    expect(isAgentProfileWorkspacePath("agents/research.md")).toBe(true);
    expect(isAgentProfileWorkspacePath("/agents/research.md")).toBe(true);
    expect(isAgentProfileWorkspacePath("agents/research/CONTEXT.md")).toBe(
      false,
    );
    expect(agentProfileSlugFromWorkspacePath("agents/coding.md")).toBe(
      "coding",
    );
  });

  it("round-trips structured profile fields through markdown frontmatter", () => {
    const content = serializeAgentProfileFile({
      slug: "research",
      name: "Research",
      description: "Finds and synthesizes sources.",
      routingGuidance: "Use for source-backed research.",
      instructions: "Return concise cited findings.",
      modelId: "claude-haiku-4-5",
      enabled: true,
      builtInKey: "research",
      toolPolicy: {
        builtInTools: ["web-search", "web-extract"],
        mcpServers: ["twenty-crm"],
      },
      skillPolicy: { skillSlugs: ["source-review"] },
      executionControls: {
        foreground: true,
        clarify: false,
        maxSubagentDepth: 0,
        maxRuntimeMs: 120000,
        maxTokens: 4096,
        thinking: "minimal",
        reviewGate: true,
        maxReviewLoops: 2,
      },
      spaceIds: ["space-research"],
    });

    const parsed = parseAgentProfileFile({
      path: "agents/research.md",
      content,
    });

    expect(parsed).toMatchObject({
      slug: "research",
      name: "Research",
      description: "Finds and synthesizes sources.",
      routingGuidance: "Use for source-backed research.",
      instructions: "Return concise cited findings.",
      modelId: "claude-haiku-4-5",
      enabled: true,
      builtInKey: "research",
      toolPolicy: {
        builtInTools: ["web-search", "web-extract"],
        mcpServers: ["twenty-crm"],
      },
      skillPolicy: { skillSlugs: ["source-review"] },
      executionControls: {
        foreground: true,
        clarify: false,
        maxSubagentDepth: 0,
        maxRuntimeMs: 120000,
        maxTokens: 4096,
        thinking: "minimal",
        reviewGate: true,
        maxReviewLoops: 2,
      },
      spaceRefs: ["space-research"],
    });
  });
});
