import { describe, expect, it } from "vitest";

import {
  agentFolderInstructionsPath,
  agentFolderSlugFromInstructionsPath,
  applyAgentFolderSidecar,
  isAgentFolderInstructionsPath,
  parseAgentFolderInstructions,
  serializeAgentFolderInstructions,
  normalizeAgentFolderExecution,
  type AgentFolderConfig,
} from "./agent-folder-format.js";

const PATH = "agents/researcher/INSTRUCTIONS.md";

function errorsOf(result: ReturnType<typeof parseAgentFolderInstructions>) {
  if (result.valid) throw new Error("expected invalid result");
  return result.errors;
}

function parsedOf(
  result: ReturnType<typeof parseAgentFolderInstructions>,
): AgentFolderConfig {
  if (!result.valid) {
    throw new Error(
      `expected valid result: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return result.parsed;
}

describe("agent folder path helpers", () => {
  it("builds and parses agents/<slug>/INSTRUCTIONS.md paths", () => {
    expect(agentFolderInstructionsPath("researcher")).toBe(PATH);
    expect(agentFolderSlugFromInstructionsPath(PATH)).toBe("researcher");
    expect(agentFolderSlugFromInstructionsPath("/" + PATH)).toBe("researcher");
    expect(isAgentFolderInstructionsPath(PATH)).toBe(true);
  });

  it("rejects legacy file paths and non-instruction paths", () => {
    expect(agentFolderSlugFromInstructionsPath("agents/researcher.md")).toBe(
      null,
    );
    expect(
      agentFolderSlugFromInstructionsPath("agents/researcher/SKILL.md"),
    ).toBe(null);
    expect(
      agentFolderSlugFromInstructionsPath("agents/a/agents/b/INSTRUCTIONS.md"),
    ).toBe(null);
  });
});

describe("serialize → parse round trip", () => {
  it("is identity for a full config", () => {
    const source = serializeAgentFolderInstructions({
      slug: "researcher",
      description: "Deep research specialist for market questions",
      model: "anthropic/claude-sonnet-5",
      enabled: false,
      execution: {
        clarify: true,
        maxRuntimeMs: 60_000,
        maxTokens: 4_000,
        costBudgetUsd: 0.25,
        maxQueriesPerRun: 5,
        thinking: "high",
        reviewGate: true,
        maxReviewLoops: 2,
      },
      instructions: "Research thoroughly.\n\nCite sources.",
    });

    const parsed = parsedOf(parseAgentFolderInstructions(source, PATH));

    expect(parsed.slug).toBe("researcher");
    expect(parsed.description).toBe(
      "Deep research specialist for market questions",
    );
    expect(parsed.model).toBe("anthropic/claude-sonnet-5");
    expect(parsed.enabled).toBe(false);
    expect(parsed.instructions).toBe("Research thoroughly.\n\nCite sources.");
    expect(parsed.execution).toMatchObject({
      foreground: true,
      clarify: true,
      maxRuntimeMs: 60_000,
      maxTokens: 4_000,
      costBudgetUsd: 0.25,
      maxQueriesPerRun: 5,
      thinking: "high",
      reviewGate: true,
      maxReviewLoops: 2,
    });
    expect(parsed.execution).not.toHaveProperty("maxSubagentDepth");
  });

  it("a minimal config defaults enabled=true with platform execution defaults", () => {
    const source = serializeAgentFolderInstructions({
      slug: "researcher",
      description: "Minimal agent",
      instructions: "Do the work.",
    });

    const parsed = parsedOf(parseAgentFolderInstructions(source, PATH));

    expect(parsed.enabled).toBe(true);
    expect(parsed.model).toBeUndefined();
    expect(parsed.execution.foreground).toBe(true);
    expect(parsed.execution.loopPolicy.mode).toBe("closed");
  });
});

describe("strict validation", () => {
  it("missing description is a typed error naming the field", () => {
    const errors = errorsOf(
      parseAgentFolderInstructions(
        "---\nmodel: anthropic/claude-sonnet-5\n---\n\nBody\n",
        PATH,
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: "MissingField",
      details: { field: "description" },
    });
  });

  it("alias keys are hard errors, not silent acceptance", () => {
    const errors = errorsOf(
      parseAgentFolderInstructions(
        [
          "---",
          "description: Aliased agent",
          "toolPolicy:",
          "  builtInTools: [web_search]",
          "executionControls:",
          "  maxTokens: 100",
          "model_id: anthropic/claude-sonnet-5",
          "name: Researcher",
          "skills: [crm]",
          "mcpServers: [postgres-dev]",
          "routingGuidance: route me",
          "---",
          "",
          "Body",
        ].join("\n"),
        PATH,
      ),
    );
    const fields = errors.map((e) => e.details.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "toolPolicy",
        "executionControls",
        "model_id",
        "name",
        "skills",
        "mcpServers",
        "routingGuidance",
      ]),
    );
    expect(errors.every((e) => e.kind === "FieldShape")).toBe(true);
  });

  it("frontmatter instructions key is an error — instructions live in the body", () => {
    const errors = errorsOf(
      parseAgentFolderInstructions(
        "---\ndescription: X\ninstructions: inline\n---\n\nBody\n",
        PATH,
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("prose body");
  });

  it("missing frontmatter block is a MissingFrontmatter error", () => {
    const errors = errorsOf(
      parseAgentFolderInstructions("Just prose, no frontmatter.\n", PATH),
    );
    expect(errors[0]?.kind).toBe("MissingFrontmatter");
  });

  it("unknown execution and loopPolicy keys (incl. snake_case aliases) error", () => {
    const errors = errorsOf(
      parseAgentFolderInstructions(
        [
          "---",
          "description: X",
          "execution:",
          "  max_tokens: 100",
          "  maxSubagentDepth: 0",
          "  loopPolicy:",
          "    fail_behavior: return_blocker",
          "---",
          "",
          "Body",
        ].join("\n"),
        PATH,
      ),
    );
    const fields = errors.map((e) => e.details.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "execution.max_tokens",
        "execution.maxSubagentDepth",
        "execution.loopPolicy.fail_behavior",
      ]),
    );
  });

  it("execution field types are enforced", () => {
    const errors = errorsOf(
      parseAgentFolderInstructions(
        [
          "---",
          "description: X",
          "enabled: yes please",
          "execution:",
          "  maxTokens: -5",
          "  clarify: 1",
          "  costBudgetUsd: free",
          "  loopPolicy:",
          "    mode: open",
          "---",
          "",
          "Body",
        ].join("\n"),
        PATH,
      ),
    );
    const fields = errors.map((e) => e.details.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "enabled",
        "execution.maxTokens",
        "execution.clarify",
        "execution.costBudgetUsd",
        "execution.loopPolicy.mode",
      ]),
    );
  });

  it("over-long descriptions are rejected", () => {
    const errors = errorsOf(
      parseAgentFolderInstructions(
        `---\ndescription: ${"x".repeat(2000)}\n---\n\nBody\n`,
        PATH,
      ),
    );
    expect(errors[0]?.kind).toBe("FieldTooLong");
  });
});

describe("optional sidecar overlay", () => {
  const base = parsedOf(
    parseAgentFolderInstructions(
      serializeAgentFolderInstructions({
        slug: "researcher",
        description: "Agent",
        instructions: "Body",
      }),
      PATH,
    ),
  );

  it("absent sidecar means enabled with no overrides", () => {
    const result = applyAgentFolderSidecar(base, null, PATH);
    expect(result.valid && result.parsed).toEqual(base);
  });

  it("present sidecar can disable and override execution", () => {
    const result = applyAgentFolderSidecar(
      base,
      { enabled: false, policy: { execution: { maxTokens: 500 } } },
      PATH,
    );
    if (!result.valid) throw new Error("expected valid");
    expect(result.parsed.enabled).toBe(false);
    expect(result.parsed.execution.maxTokens).toBe(500);
  });

  it("sidecar execution overrides are validated strictly", () => {
    const result = applyAgentFolderSidecar(
      base,
      { policy: { execution: { max_tokens: 500 } } },
      PATH,
    );
    expect(result.valid).toBe(false);
  });
});

describe("normalizeAgentFolderExecution", () => {
  it("never emits a depth field", () => {
    expect(normalizeAgentFolderExecution({})).not.toHaveProperty(
      "maxSubagentDepth",
    );
  });
});

describe("builtInTools frontmatter (subagent-folders U7)", () => {
  it("round-trips the built-in tool surface", () => {
    const source = serializeAgentFolderInstructions({
      slug: "research",
      description: "Researcher",
      builtInTools: ["web-search", "web-extract"],
      instructions: "Research.",
    });
    const result = parseAgentFolderInstructions(
      source,
      "agents/research/INSTRUCTIONS.md",
    );
    if (!result.valid) throw new Error("expected valid");
    expect(result.parsed.builtInTools).toEqual(["web-search", "web-extract"]);
  });

  it("rejects non-string entries", () => {
    const result = parseAgentFolderInstructions(
      "---\ndescription: X\nbuiltInTools:\n  - web-search\n  - 3\n---\n\nBody\n",
      "agents/research/INSTRUCTIONS.md",
    );
    expect(result.valid).toBe(false);
  });
});
