/**
 * Shared bound-KB resolver (KB-MCP retrieval): binding rows whose
 * `search_config.retrieval` delegates to an MCP knowledge server resolve to
 * a ready-to-call url/auth for the container; everything else keeps the
 * Bedrock shape byte-identical to the previous per-call-site builds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queryResults: [] as unknown[][],
  resolveTarget: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(h.queryResults.shift() ?? []),
        }),
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  knowledgeBases: {
    aws_kb_id: "kb.aws_kb_id",
    name: "kb.name",
    description: "kb.description",
    tenant_id: "kb.tenant_id",
    id: "kb.id",
  },
  agentKnowledgeBases: {
    knowledge_base_id: "akb.knowledge_base_id",
    agent_id: "akb.agent_id",
    tenant_id: "akb.tenant_id",
    enabled: "akb.enabled",
    search_config: "akb.search_config",
  },
  spaceKnowledgeBases: {
    knowledge_base_id: "skb.knowledge_base_id",
    space_id: "skb.space_id",
    tenant_id: "skb.tenant_id",
    enabled: "skb.enabled",
    search_config: "skb.search_config",
  },
}));

vi.mock("./mcp-configs.js", () => ({
  resolveTenantMcpServerTarget: h.resolveTarget,
}));

import {
  mcpRetrievalDirective,
  resolveBoundKnowledgeBases,
} from "./bound-knowledge-bases.js";

const BEDROCK_ROW = {
  aws_kb_id: "KBAAAA",
  name: "Runbooks",
  description: null,
  search_config: null,
};

const MCP_ROW = {
  aws_kb_id: "KBLEGACY",
  name: "CX SOPs",
  description: "SOP corpus",
  search_config: {
    retrieval: { mode: "mcp", server: "brain-kb", tool: "brain_knowledge_search" },
  },
};

beforeEach(() => {
  h.queryResults.length = 0;
  h.resolveTarget.mockReset();
});

describe("mcpRetrievalDirective", () => {
  it("parses a well-formed directive", () => {
    expect(mcpRetrievalDirective(MCP_ROW.search_config)).toEqual({
      server: "brain-kb",
      tool: "brain_knowledge_search",
    });
  });

  it.each([
    [null],
    [{}],
    [{ retrieval: { mode: "bedrock" } }],
    [{ retrieval: { mode: "mcp", server: "", tool: "t" } }],
    [{ retrieval: { mode: "mcp", server: "s" } }],
  ])("rejects %j", (config) => {
    expect(mcpRetrievalDirective(config)).toBeNull();
  });
});

describe("resolveBoundKnowledgeBases", () => {
  it("keeps plain Bedrock bindings byte-identical to the old shape", async () => {
    h.queryResults.push([]);
    const resolved = await resolveBoundKnowledgeBases({
      tenantId: "t1",
      agentRows: [BEDROCK_ROW],
      spaceId: "s1",
    });
    expect(resolved).toEqual([
      { awsKbId: "KBAAAA", name: "Runbooks", description: null },
    ]);
    expect(h.resolveTarget).not.toHaveBeenCalled();
  });

  it("resolves an MCP directive to a ready-to-call retrieval config", async () => {
    h.resolveTarget.mockResolvedValue({
      kind: "ok",
      authType: "service_credential",
      target: {
        url: "https://mcp.brain.example/kb",
        name: "brain-kb",
        token: "tkt_secret",
      },
    });
    const resolved = await resolveBoundKnowledgeBases({
      tenantId: "t1",
      agentRows: [MCP_ROW],
    });
    expect(h.resolveTarget).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", serverName: "brain-kb" }),
    );
    expect(resolved).toEqual([
      {
        name: "CX SOPs",
        description: "SOP corpus",
        retrieval: {
          mode: "mcp",
          url: "https://mcp.brain.example/kb",
          toolName: "brain_knowledge_search",
          token: "tkt_secret",
        },
      },
    ]);
    // Deliberate: no awsKbId on a delegated entry — the container must not
    // double-query Bedrock for the same KB.
    expect(resolved?.[0]).not.toHaveProperty("awsKbId");
  });

  it("falls back to the row's Bedrock id when the MCP server does not resolve", async () => {
    h.resolveTarget.mockResolvedValue({
      kind: "missing",
      reason: "MCP server no longer exists",
    });
    const resolved = await resolveBoundKnowledgeBases({
      tenantId: "t1",
      agentRows: [MCP_ROW],
    });
    expect(resolved).toEqual([
      { awsKbId: "KBLEGACY", name: "CX SOPs", description: "SOP corpus" },
    ]);
  });

  it("dedupes agent and space bindings to the same target", async () => {
    h.queryResults.push([BEDROCK_ROW]);
    const resolved = await resolveBoundKnowledgeBases({
      tenantId: "t1",
      agentRows: [BEDROCK_ROW],
      spaceId: "s1",
    });
    expect(resolved).toHaveLength(1);
  });

  it("returns undefined when nothing is bound (AE3)", async () => {
    h.queryResults.push([]);
    const resolved = await resolveBoundKnowledgeBases({
      tenantId: "t1",
      agentRows: [],
      spaceId: "s1",
    });
    expect(resolved).toBeUndefined();
  });
});
