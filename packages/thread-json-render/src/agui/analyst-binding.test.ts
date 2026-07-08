/**
 * Analyst run_query binding helper tests (THINK-228 U7, KTD2).
 */

import { describe, expect, it } from "vitest";

import {
  analystColumnsShapeHash,
  analystEnvelopeFromRaw,
  applyCanvasBoundData,
  canvasShapeHashForToolResult,
  projectAnalystEnvelopeRows,
} from "./analyst-binding.js";
import { resultShapeHash } from "./shape-hash.js";

const COLUMNS = [
  { name: "tenant", pg_type: "text" },
  { name: "n", pg_type: "int8" },
];

function envelope(over: Record<string, unknown> = {}) {
  return {
    columns: COLUMNS,
    rows: [
      ["acme", 12],
      ["globex", 7],
    ],
    row_count: 2,
    truncated: false,
    stats: { tenant: { nulls: 0, min: "acme", max: "globex" } },
    result_file: null,
    ...over,
  };
}

function mcpRaw(env: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(env) }],
    isError: false,
  };
}

describe("analystEnvelopeFromRaw", () => {
  it("parses an envelope from a raw MCP tool result and from a bare object", () => {
    expect(analystEnvelopeFromRaw(mcpRaw(envelope()))?.columns).toEqual(
      COLUMNS,
    );
    expect(analystEnvelopeFromRaw(envelope())?.row_count).toBe(2);
  });

  it("returns null for non-envelope payloads", () => {
    expect(
      analystEnvelopeFromRaw({ content: [{ type: "text", text: "hi" }] }),
    ).toBeNull();
    expect(analystEnvelopeFromRaw("nope")).toBeNull();
    expect(analystEnvelopeFromRaw({ columns: [{ name: 1 }] })).toBeNull();
  });
});

describe("KTD2 — value-invariant descriptor hash", () => {
  it("is identical across data volume, null churn, and staging churn", () => {
    const small = analystEnvelopeFromRaw(mcpRaw(envelope()))!;
    const churned = analystEnvelopeFromRaw(
      mcpRaw(
        envelope({
          rows: [
            ["acme", null],
            [null, 99],
          ],
          row_count: 50_000,
          truncated: true,
          result_file: "s3://bucket/analyst-staging/t/x.csv",
          stats: { tenant: { nulls: 3, min: null, max: null } },
        }),
      ),
    )!;
    expect(analystColumnsShapeHash(small.columns)).toEqual(
      analystColumnsShapeHash(churned.columns),
    );
    // …while the generic structural hash DOES flip on that churn — the trap
    // this module exists to avoid.
    expect(resultShapeHash(envelope())).not.toEqual(
      resultShapeHash(
        envelope({ result_file: "s3://bucket/analyst-staging/t/x.csv" }),
      ),
    );
  });

  it("changes on a genuine column-set change", () => {
    const base = analystColumnsShapeHash(COLUMNS);
    expect(
      analystColumnsShapeHash([...COLUMNS, { name: "extra", pg_type: "text" }]),
    ).not.toEqual(base);
    expect(
      analystColumnsShapeHash([
        { name: "tenant", pg_type: "text" },
        { name: "n", pg_type: "numeric" }, // type change
      ]),
    ).not.toEqual(base);
  });

  it("canvasShapeHashForToolResult routes run_query to the descriptor and others to the generic hash", () => {
    const raw = mcpRaw(envelope());
    const generic = (value: unknown) => resultShapeHash(value);
    expect(
      canvasShapeHashForToolResult({
        toolName: "run_query",
        raw,
        genericHash: generic,
      }),
    ).toBe(analystColumnsShapeHash(COLUMNS));
    expect(
      canvasShapeHashForToolResult({
        toolName: "list_deals",
        raw,
        genericHash: generic,
      }),
    ).toBe(resultShapeHash(raw));
  });
});

describe("envelope → component projection + bound-data merge (AE3 render half)", () => {
  const spec = {
    root: "root",
    elements: {
      root: { type: "stack", props: {}, children: ["chart-1", "table-1"] },
      "chart-1": {
        type: "chart",
        props: {
          kind: "bar",
          xKey: "tenant",
          series: [{ dataKey: "n", colorKey: "chart-1" }],
          data: [{ tenant: "acme", n: 1 }],
        },
        children: [],
      },
      "table-1": {
        type: "table",
        props: {
          columns: [
            { id: "tenant", header: "Tenant" },
            { id: "n", header: "Threads" },
          ],
          rows: [{ id: "r1", tenant: "acme", n: 1 }],
        },
        children: [],
      },
    },
  };
  const data = { spec, mobileFallback: { title: "Report" } };

  it("projects rows keyed by column name, capped at the component limit", () => {
    const env = analystEnvelopeFromRaw(envelope())!;
    expect(projectAnalystEnvelopeRows(env)).toEqual([
      { tenant: "acme", n: 12 },
      { tenant: "globex", n: 7 },
    ]);
    const big = analystEnvelopeFromRaw(
      envelope({ rows: Array.from({ length: 80 }, (_, i) => [`t${i}`, i]) }),
    )!;
    expect(projectAnalystEnvelopeRows(big)).toHaveLength(50);
  });

  it("merges refreshed bound data into chart data and table rows", () => {
    const boundData = { "": { payload: mcpRaw(envelope()) } };
    const merged = applyCanvasBoundData(data, boundData) as typeof data;
    expect(merged).not.toBe(data);
    const chart = merged.spec.elements["chart-1"] as {
      props: { data: unknown };
    };
    const table = merged.spec.elements["table-1"] as {
      props: { rows: unknown };
    };
    expect(chart.props.data).toEqual([
      { tenant: "acme", n: 12 },
      { tenant: "globex", n: 7 },
    ]);
    expect(table.props.rows).toEqual(chart.props.data);
    // Untouched original.
    expect(
      (data.spec.elements["chart-1"] as { props: { data: unknown[] } }).props
        .data,
    ).toHaveLength(1);
  });

  it("returns the input untouched when bound data is absent or not an envelope", () => {
    expect(applyCanvasBoundData(data, null)).toBe(data);
    expect(applyCanvasBoundData(data, {})).toBe(data);
    expect(
      applyCanvasBoundData(data, { "": { payload: { hello: "world" } } }),
    ).toBe(data);
  });
});
