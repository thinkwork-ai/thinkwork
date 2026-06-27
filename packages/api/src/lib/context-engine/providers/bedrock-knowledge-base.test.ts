import { describe, expect, it, vi } from "vitest";

// Keep the module import light — we only exercise the pure dedup helper.
vi.mock("@aws-sdk/client-bedrock-agent-runtime", () => ({
  BedrockAgentRuntimeClient: class {},
  RetrieveCommand: class {},
}));
vi.mock("../../../graphql/utils.js", () => ({
  agentKnowledgeBases: {},
  db: {},
  knowledgeBases: {},
  spaceKnowledgeBases: {},
}));

import { dedupeKnowledgeBases } from "./bedrock-knowledge-base.js";

describe("dedupeKnowledgeBases (U7 union/dedup)", () => {
  it("returns one entry for a KB bound at both agent and Space scope (AE2)", () => {
    const agentBound = { id: "kb-1", name: "Policies", awsKbId: "aws-1" };
    const spaceBound = { id: "kb-1", name: "Policies", awsKbId: "aws-1" };
    const result = dedupeKnowledgeBases([agentBound, spaceBound]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("kb-1");
  });

  it("unions distinct agent- and Space-bound KBs", () => {
    const result = dedupeKnowledgeBases([
      { id: "kb-1", name: "Tenant-wide", awsKbId: "aws-1" },
      { id: "kb-2", name: "Space-only", awsKbId: "aws-2" },
    ]);
    expect(result.map((r) => r.id).sort()).toEqual(["kb-1", "kb-2"]);
  });

  it("drops KBs without a provisioned aws_kb_id", () => {
    const result = dedupeKnowledgeBases([
      { id: "kb-1", name: "Ready", awsKbId: "aws-1" },
      { id: "kb-2", name: "Not provisioned", awsKbId: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("kb-1");
  });

  it("returns an empty array for no inputs", () => {
    expect(dedupeKnowledgeBases([])).toEqual([]);
  });
});

describe("Bedrock Knowledge Base Context Engine provider", () => {
  it("is not a default Context Engine provider unless explicitly enabled", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    const { createBedrockKnowledgeBaseContextProvider } =
      await import("./bedrock-knowledge-base.js");

    expect(createBedrockKnowledgeBaseContextProvider()).toMatchObject({
      id: "bedrock-knowledge-base",
      displayName: "Bedrock Knowledge Bases (legacy)",
      defaultEnabled: false,
    });
  });

  it("can still be opted into for compatibility", async () => {
    vi.resetModules();
    vi.stubEnv("CONTEXT_ENGINE_BEDROCK_KB_DEFAULT_ENABLED", "true");
    const { createBedrockKnowledgeBaseContextProvider } =
      await import("./bedrock-knowledge-base.js");

    expect(createBedrockKnowledgeBaseContextProvider().defaultEnabled).toBe(
      true,
    );
  });
});
