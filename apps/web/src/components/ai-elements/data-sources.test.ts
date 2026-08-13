import { describe, expect, it } from "vitest";
import { dataCitationsFromInvocations } from "./data-sources";

const brainAskInvocation = (
  dataCitations: unknown,
  toolName = "brain_ask",
) => ({
  tool_name: "mcp_thinkwork_brain_brain_ask",
  result: {
    content: [{ type: "text", text: "answer…" }],
    details: {
      server_name: "thinkwork-brain",
      mcp_tool_name: toolName,
      raw: { structuredContent: { dataCitations } },
    },
  },
});

const sqlCitation = {
  kind: "analytics",
  query: "SELECT * FROM fct_ar_open_invoices",
  database: "mart_analytics",
  tables: ["fct_ar_open_invoices"],
  rowCount: 42,
  queryExecutionId: "athena-123",
  packSequence: 1,
  elapsedMs: 812,
};

describe("dataCitationsFromInvocations", () => {
  it("extracts and numbers citations from brain_ask invocations", () => {
    const rows = dataCitationsFromInvocations([
      brainAskInvocation([
        sqlCitation,
        {
          kind: "graph",
          query: "MATCH (n) RETURN n",
          rowCount: 3,
          elapsedMs: 40,
        },
      ]),
    ]);
    expect(rows).toEqual([
      { ...sqlCitation, n: 1 },
      {
        kind: "graph",
        query: "MATCH (n) RETURN n",
        rowCount: 3,
        elapsedMs: 40,
        n: 2,
      },
    ]);
  });

  it("dedupes identical citations re-reported by brain_ask_result", () => {
    const rows = dataCitationsFromInvocations([
      brainAskInvocation([sqlCitation]),
      brainAskInvocation([sqlCitation], "brain_ask_result"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].n).toBe(1);
  });

  it("keeps citations that differ only in rowCount", () => {
    const rows = dataCitationsFromInvocations([
      brainAskInvocation([sqlCitation, { ...sqlCitation, rowCount: 7 }]),
    ]);
    expect(rows.map((row) => row.rowCount)).toEqual([42, 7]);
  });

  it("drops rows missing the required fields", () => {
    const rows = dataCitationsFromInvocations([
      brainAskInvocation([
        { kind: "analytics", rowCount: "42", elapsedMs: 10 },
        { kind: "cypher", rowCount: 1, elapsedMs: 10 },
        { kind: "graph", rowCount: 1 },
        { kind: "graph", rowCount: 1, elapsedMs: 10 },
        "not-an-object",
        null,
      ]),
    ]);
    expect(rows).toEqual([{ kind: "graph", rowCount: 1, elapsedMs: 10, n: 1 }]);
  });

  it("keeps the redaction-gated shape (no query text)", () => {
    const rows = dataCitationsFromInvocations([
      brainAskInvocation([
        { kind: "analytics", tables: ["fct_x"], rowCount: 5, elapsedMs: 90 },
      ]),
    ]);
    expect(rows[0].query).toBeUndefined();
    expect(rows[0].tables).toEqual(["fct_x"]);
  });

  it("yields [] for malformed or absent structuredContent", () => {
    expect(dataCitationsFromInvocations([brainAskInvocation("nope")])).toEqual(
      [],
    );
    expect(
      dataCitationsFromInvocations([
        brainAskInvocation({ not: "an array" }),
        {
          tool_name: "mcp_thinkwork_brain_brain_ask",
          result: { details: { mcp_tool_name: "brain_ask", raw: null } },
        },
        {
          tool_name: "mcp_thinkwork_brain_brain_ask",
          result: { details: { mcp_tool_name: "brain_ask" } },
        },
        "not-an-object",
        null,
      ]),
    ).toEqual([]);
  });

  it("ignores MCP tools that are not brain_ask", () => {
    expect(
      dataCitationsFromInvocations([
        brainAskInvocation([sqlCitation], "brain_search"),
        { name: "search_knowledge", result: {} },
      ]),
    ).toEqual([]);
  });
});
