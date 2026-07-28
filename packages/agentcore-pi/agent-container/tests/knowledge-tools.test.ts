/**
 * search_knowledge Pi tool tests (external S3 KB source U7).
 *
 * The Bedrock agent-runtime SDK is mocked; these pin the tool contract:
 * AE3 (no bound KBs ⇒ no tool assembled — asserted via the builder's
 * guard), AE4 (document identity + edition metadata ride the result so
 * citation needs no second lookup), multi-KB merge with attribution,
 * scope guard, and error-as-result (never a crash).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  retrieveCalls: [] as any[],
  responsesByKbId: new Map<string, any>(),
  throwFor: new Set<string>(),
}));

vi.mock("@aws-sdk/client-bedrock-agent-runtime", () => {
  class RetrieveCommand {
    constructor(readonly input: any) {}
  }
  class BedrockAgentRuntimeClient {
    async send(command: any) {
      h.retrieveCalls.push(command.input);
      const kbId = command.input.knowledgeBaseId;
      if (h.throwFor.has(kbId)) {
        throw new Error(`ThrottlingException for ${kbId}`);
      }
      return h.responsesByKbId.get(kbId) ?? { retrievalResults: [] };
    }
  }
  return { BedrockAgentRuntimeClient, RetrieveCommand };
});

import {
  buildKnowledgeTools,
  KnowledgeToolError,
} from "../src/tools/knowledge.js";

/** Narrow a tool result's first content block to its text. */
function firstText(result: { content: Array<{ type: string }> }): string {
  const block = result.content[0] as { type: string; text?: string };
  return block.text ?? "";
}

const KB_A = { awsKbId: "KBAAAA", name: "CX SOPs", description: null };
const KB_B = { awsKbId: "KBBBBB", name: "Runbooks", description: null };

function hit(text: string, key: string, score: number, metadata = {}) {
  return {
    content: { text },
    score,
    location: { customDocumentLocation: { id: key } },
    metadata,
  };
}

beforeEach(() => {
  h.retrieveCalls.length = 0;
  h.responsesByKbId.clear();
  h.throwFor.clear();
});

describe("buildKnowledgeTools", () => {
  it("builds exactly one search_knowledge tool naming the bound KBs", () => {
    const tools = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "t1",
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("search_knowledge");
    expect(tools[0].description).toContain("CX SOPs");
  });

  it("numbers citations continuously across searches in one turn", async () => {
    // Two searches that both restarted at [1] would make the answer's markers
    // ambiguous — the reader could not tell which document a claim came from.
    h.responsesByKbId.set("KBAAAA", {
      retrievalResults: [
        hit("first passage", "a.pdf#p=1", 0.9),
        hit("second passage", "b.pdf#p=2", 0.8),
      ],
    });
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "t1",
    });

    const first = await tool.execute("call-1", { query: "one" });
    expect(firstText(first)).toContain("[1]");
    expect(firstText(first)).toContain("[2]");
    expect(
      first.details.hits.map((x: { citation: number }) => x.citation),
    ).toEqual([1, 2]);

    const second = await tool.execute("call-2", { query: "two" });
    expect(firstText(second)).toContain("[3]");
    expect(firstText(second)).toContain("[4]");
    expect(
      second.details.hits.map((x: { citation: number }) => x.citation),
    ).toEqual([3, 4]);
  });

  it("carries a quote excerpt for the citation hover card", async () => {
    h.responsesByKbId.set("KBAAAA", {
      retrievalResults: [
        hit("Always add new code at bottom", "a.pdf#p=1", 0.9),
      ],
    });
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "t1",
    });
    const result = await tool.execute("call-q", { query: "reason code" });
    expect(result.details.hits[0].quote).toBe("Always add new code at bottom");
  });

  it("derives the page number from a page-document id, not from metadata", async () => {
    // Page provenance CANNOT ride inline metadata attributes: with an
    // RDS-backed vector store Bedrock writes each attribute to its own table
    // column, so an attributed document fails ingestion outright. The id is
    // the carrier.
    h.responsesByKbId.set("KBAAAA", {
      retrievalResults: [
        hit(
          "Always add new code at bottom",
          "cx/files/CX-0215 Reason Code.pdf#p=1",
          0.9,
        ),
      ],
    });
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "t1",
    });
    const result = await tool.execute("call-p", { query: "reason code" });
    // The KEY must come back without the page suffix — the presigned-URL
    // lookup and the manifest both key on the source document.
    expect(result.details.hits[0]).toMatchObject({
      documentKey: "cx/files/CX-0215 Reason Code.pdf",
      pageNumber: 1,
    });
    expect(firstText(result)).toContain(
      "Source: cx/files/CX-0215 Reason Code.pdf (page 1)",
    );
  });

  it("leaves documents ingested whole without a page number", async () => {
    h.responsesByKbId.set("KBAAAA", {
      retrievalResults: [hit("Reference sheet", "cx/files/CX-0144.xlsx", 0.8)],
    });
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "t1",
    });
    const result = await tool.execute("call-n", { query: "codes" });
    expect(result.details.hits[0].pageNumber).toBeUndefined();
    expect(firstText(result)).not.toContain("page");
  });

  it("AE4: a Retrieve hit's document identity + edition ride the tool result", async () => {
    h.responsesByKbId.set("KBAAAA", {
      retrievalResults: [
        hit(
          "To release a credit hold, open JDE …",
          "cx/files/CX-0014.pdf",
          0.9,
          {
            edition: 3,
            effective_from: "2026-05-01T00:00:00Z",
          },
        ),
      ],
    });
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "t1",
    });
    const result = await tool.execute("call-1", { query: "credit hold" });
    const text = firstText(result);
    expect(text).toContain("To release a credit hold");
    expect(text).toContain("Source: cx/files/CX-0014.pdf (edition 3)");
    expect(result.details.hits[0]).toMatchObject({
      documentKey: "cx/files/CX-0014.pdf",
      edition: 3,
    });
  });

  it("merges hits across bound KBs sorted by score, with per-hit attribution", async () => {
    h.responsesByKbId.set("KBAAAA", {
      retrievalResults: [hit("low relevance", "a.pdf", 0.2)],
    });
    h.responsesByKbId.set("KBBBBB", {
      retrievalResults: [hit("high relevance", "b.pdf", 0.95)],
    });
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A, KB_B],
      tenantId: "t1",
    });
    const result = await tool.execute("call-1", { query: "anything" });
    expect(h.retrieveCalls.map((call) => call.knowledgeBaseId)).toEqual([
      "KBAAAA",
      "KBBBBB",
    ]);
    const text = firstText(result);
    expect(text.indexOf("high relevance")).toBeLessThan(
      text.indexOf("low relevance"),
    );
    expect(text).toContain("[Runbooks]");
    expect(text).toContain("[CX SOPs]");
  });

  it("missing tenant scope throws before any AWS call", async () => {
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "",
    });
    await expect(tool.execute("call-1", { query: "q" })).rejects.toThrow(
      KnowledgeToolError,
    );
    expect(h.retrieveCalls).toHaveLength(0);
  });

  it("a throttled/errored Retrieve returns a tool-level error message, not a crash", async () => {
    h.throwFor.add("KBAAAA");
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "t1",
    });
    const result = await tool.execute("call-1", { query: "q" });
    expect(firstText(result)).toContain("Knowledge search failed");
    expect(firstText(result)).toContain("ThrottlingException");
  });

  it("partial failure: surviving KB hits win over a failing sibling", async () => {
    h.throwFor.add("KBAAAA");
    h.responsesByKbId.set("KBBBBB", {
      retrievalResults: [hit("from runbooks", "b.pdf", 0.8)],
    });
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A, KB_B],
      tenantId: "t1",
    });
    const result = await tool.execute("call-1", { query: "q" });
    expect(firstText(result)).toContain("from runbooks");
    expect(result.details.failures).toHaveLength(1);
  });

  it("s3-crawler hits (managed-upload docs) resolve identity from the s3 uri", async () => {
    h.responsesByKbId.set("KBAAAA", {
      retrievalResults: [
        {
          content: { text: "uploaded doc passage" },
          score: 0.5,
          location: {
            s3Location: { uri: "s3://workspace/tenants/acme/kb/doc.pdf" },
          },
        },
      ],
    });
    const [tool] = buildKnowledgeTools({
      knowledgeBases: [KB_A],
      tenantId: "t1",
    });
    const result = await tool.execute("call-1", { query: "q" });
    expect(result.details.hits[0].documentKey).toBe("tenants/acme/kb/doc.pdf");
  });
});

/**
 * MCP retrieval backend (KB-MCP retrieval): a bound KB whose entry carries an
 * API-resolved `retrieval` config queries an external MCP knowledge server
 * over plain JSON-RPC instead of Bedrock. The container stays a generic
 * client — these tests pin the wire shape, auth header assembly, structured
 * and text-only normalization, and error-as-result parity with Bedrock.
 */
describe("search_knowledge MCP backend", () => {
  const MCP_KB = {
    name: "CX SOPs (brain)",
    description: null,
    retrieval: {
      mode: "mcp" as const,
      url: "https://mcp.example.test/kb",
      toolName: "brain_knowledge_search",
      token: "tkt_secret",
    },
  };

  function mcpResponse(structuredContent: unknown, text = "rendered") {
    return {
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: "search_knowledge",
        result: { content: [{ type: "text", text }], structuredContent },
      }),
    };
  }

  it("queries the MCP server, not Bedrock, and normalizes structured hits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mcpResponse({
        ok: true,
        results: [
          {
            id: "cx/CX-0215.pdf#p=3",
            title: "cx/CX-0215.pdf#p=3",
            text: "Add the new reason code at the bottom",
            score: 0.71,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const [tool] = buildKnowledgeTools({
        knowledgeBases: [MCP_KB],
        tenantId: "t1",
      });
      const result = await tool.execute("call-1", { query: "reason code" });

      expect(h.retrieveCalls).toHaveLength(0);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://mcp.example.test/kb");
      expect(init.headers.Authorization).toBe("Bearer tkt_secret");
      const body = JSON.parse(init.body);
      expect(body.method).toBe("tools/call");
      expect(body.params.name).toBe("brain_knowledge_search");
      expect(body.params.arguments.query).toBe("reason code");

      expect(result.details.hits[0]).toMatchObject({
        documentKey: "cx/CX-0215.pdf",
        pageNumber: 3,
        score: 0.71,
      });
      expect(firstText(result)).toContain("[CX SOPs (brain)]");
      expect(firstText(result)).toContain("Add the new reason code");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("merges MCP and Bedrock hits by score in one result", async () => {
    h.responsesByKbId.set("KBBBBB", {
      retrievalResults: [hit("bedrock passage", "runbook.pdf", 0.9)],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mcpResponse({
          results: [{ id: "brain.pdf", text: "brain passage", score: 0.4 }],
        }),
      ),
    );
    try {
      const [tool] = buildKnowledgeTools({
        knowledgeBases: [MCP_KB, KB_B],
        tenantId: "t1",
      });
      const result = await tool.execute("call-1", { query: "q" });
      expect(
        result.details.hits.map((x: { documentKey: string }) => x.documentKey),
      ).toEqual(["runbook.pdf", "brain.pdf"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an MCP failure is a tool-level failure, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    try {
      const [tool] = buildKnowledgeTools({
        knowledgeBases: [MCP_KB],
        tenantId: "t1",
      });
      const result = await tool.execute("call-1", { query: "q" });
      expect(firstText(result)).toContain("Knowledge search failed");
      expect(result.details.failures[0]).toContain("503");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an isError tool result surfaces the server's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: "search_knowledge",
          result: {
            isError: true,
            content: [{ type: "text", text: "No collections configured" }],
          },
        }),
      }),
    );
    try {
      const [tool] = buildKnowledgeTools({
        knowledgeBases: [MCP_KB],
        tenantId: "t1",
      });
      const result = await tool.execute("call-1", { query: "q" });
      expect(result.details.failures[0]).toContain("No collections configured");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the rendered text when no structured rows exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mcpResponse({}, "one flat passage")),
    );
    try {
      const [tool] = buildKnowledgeTools({
        knowledgeBases: [MCP_KB],
        tenantId: "t1",
      });
      const result = await tool.execute("call-1", { query: "q" });
      expect(result.details.hitCount).toBe(1);
      expect(firstText(result)).toContain("one flat passage");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
