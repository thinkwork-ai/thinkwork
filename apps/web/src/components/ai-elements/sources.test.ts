import { describe, expect, it } from "vitest";
import {
  knowledgeCitationsFromInvocations,
  knowledgeSourceKeysFromInvocations,
  knowledgeSourcesFromInvocations,
} from "./sources";

const hitText = (key: string, edition?: number) =>
  `1. [CX SOPs] Some passage text\n   Source: ${key}${edition ? ` (edition ${edition})` : ""}`;

describe("knowledgeSourceKeysFromInvocations", () => {
  it("extracts and dedupes Source lines from runner-shaped invocations", () => {
    const keys = knowledgeSourceKeysFromInvocations([
      {
        name: "search_knowledge",
        result: {
          content: [
            { text: hitText("cx/files/CX-0072 Billing.pdf") },
            {
              text: `${hitText("cx/files/CX-0217 PODs.pdf", 2)}\n\n${hitText(
                "cx/files/CX-0072 Billing.pdf",
              )}`,
            },
          ],
        },
      },
      {
        name: "search_knowledge",
        result: { content: [{ text: hitText("cx/files/CX-0226 ACE.pdf") }] },
      },
    ]);
    expect(keys).toEqual([
      "cx/files/CX-0072 Billing.pdf",
      "cx/files/CX-0217 PODs.pdf",
      "cx/files/CX-0226 ACE.pdf",
    ]);
  });

  it("reads ledger-shaped records via output_preview and ignores other tools", () => {
    const keys = knowledgeSourceKeysFromInvocations([
      {
        tool_name: "search_knowledge",
        output_preview: hitText("cx/files/CX-0144 Codes.xlsx"),
      },
      { tool_name: "web_search", output_preview: hitText("not/a/kb-doc.pdf") },
      "not-an-object",
      null,
    ]);
    expect(keys).toEqual(["cx/files/CX-0144 Codes.xlsx"]);
  });

  it("returns empty for turns with no knowledge searches", () => {
    expect(
      knowledgeSourceKeysFromInvocations([{ name: "emit_json_render_ui" }]),
    ).toEqual([]);
  });
});

describe("knowledgeSourcesFromInvocations — page citations", () => {
  const pageHit = (
    key: string,
    opts: { page?: number; edition?: number; transcribed?: boolean } = {},
  ) =>
    `1. [CX SOPs] Some passage text\n   Source: ${key}` +
    (opts.page ? ` (page ${opts.page})` : "") +
    (opts.edition ? ` (edition ${opts.edition})` : "") +
    (opts.transcribed ? " [transcribed from a scan/screenshot]" : "");

  it("extracts the page a passage came from", () => {
    expect(
      knowledgeSourcesFromInvocations([
        {
          name: "search_knowledge",
          result: {
            content: [
              {
                text: pageHit("cx/files/CX-0215 Reason Code.pdf", { page: 1 }),
              },
            ],
          },
        },
      ]),
    ).toEqual([{ key: "cx/files/CX-0215 Reason Code.pdf", page: 1 }]);
  });

  it("keeps the key unadorned when page, edition and provenance are all present", () => {
    // The key is what resolves a presigned URL — every suffix the runtime
    // appends has to be stripped back off, or the source row 404s.
    expect(
      knowledgeSourcesFromInvocations([
        {
          tool_name: "search_knowledge",
          output_preview: pageHit("cx/files/CX-0024 - Receiving PO.pdf", {
            page: 12,
            edition: 3,
            transcribed: true,
          }),
        },
      ]),
    ).toEqual([{ key: "cx/files/CX-0024 - Receiving PO.pdf", page: 12 }]);
  });

  it("keeps the first cited page when one document is cited from several", () => {
    const sources = knowledgeSourcesFromInvocations([
      {
        name: "search_knowledge",
        result: {
          content: [
            { text: pageHit("a.pdf", { page: 4 }) },
            { text: pageHit("a.pdf", { page: 9 }) },
          ],
        },
      },
    ]);
    expect(sources).toEqual([{ key: "a.pdf", page: 4 }]);
  });

  it("leaves page undefined for documents ingested without transcription", () => {
    expect(
      knowledgeSourcesFromInvocations([
        {
          name: "search_knowledge",
          result: { content: [{ text: pageHit("cx/files/CX-0144.xlsx") }] },
        },
      ]),
    ).toEqual([{ key: "cx/files/CX-0144.xlsx", page: undefined }]);
  });
});

describe("MCP knowledge-server invocations", () => {
  const mcpInvocation = (rows: unknown[], toolName = "brain_knowledge_search") => ({
    tool_name: "mcp_brain_kb_brain_knowledge_search",
    result: {
      content: [{ type: "text", text: "[1] rendered…" }],
      details: {
        server_name: "brain-kb",
        mcp_tool_name: toolName,
        raw: { structuredContent: { results: rows } },
      },
    },
  });

  it("extracts sources with pages and documentUrl from structured rows", () => {
    const sources = knowledgeSourcesFromInvocations([
      mcpInvocation([
        {
          id: "CX-0215 Setting Up New Reason Code.pdf#p=1",
          text: "UDC in navigator…",
          score: 0.4,
          documentUrl: "https://signed.example/doc1",
        },
        {
          id: "CX-0144 Codes.xlsx",
          text: "code table",
          score: 0.3,
        },
        // Same document, later page: first citation wins.
        {
          id: "CX-0215 Setting Up New Reason Code.pdf#p=3",
          text: "another page",
          score: 0.2,
        },
      ]),
    ]);
    expect(sources).toEqual([
      {
        key: "CX-0215 Setting Up New Reason Code.pdf",
        page: 1,
        documentUrl: "https://signed.example/doc1",
      },
      { key: "CX-0144 Codes.xlsx", page: undefined, documentUrl: undefined },
    ]);
  });

  it("numbers inline citations by row order with quotes and documentUrl", () => {
    const citations = knowledgeCitationsFromInvocations([
      mcpInvocation([
        {
          id: "CX-0215 Setting Up New Reason Code.pdf#p=1",
          text: "UDC in navigator…",
          documentUrl: "https://signed.example/doc1",
        },
        { id: "CX-0144 Codes.xlsx", text: "code table" },
      ]),
    ]);
    expect(citations.get(1)).toEqual({
      n: 1,
      key: "CX-0215 Setting Up New Reason Code.pdf",
      page: 1,
      quote: "UDC in navigator…",
      documentUrl: "https://signed.example/doc1",
    });
    expect(citations.get(2)?.key).toBe("CX-0144 Codes.xlsx");
    expect(citations.get(2)?.documentUrl).toBeUndefined();
  });

  it("ignores MCP tools that are not knowledge searches", () => {
    expect(
      knowledgeSourcesFromInvocations([
        mcpInvocation([{ id: "row.pdf", text: "x" }], "brain_cypher"),
      ]),
    ).toEqual([]);
  });
});
