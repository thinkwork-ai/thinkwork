import { describe, expect, it } from "vitest";
import {
  ANALYSIS_OPS,
  ANALYSIS_VOCABULARY_VERSION,
  computeAnalysis,
  getAnalysisOp,
} from "./document-analyses.js";

function expectOk(result: ReturnType<typeof computeAnalysis>) {
  if (!result.ok) {
    throw new Error(
      `expected ok, got diagnostics: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result;
}

function expectRejected(result: ReturnType<typeof computeAnalysis>) {
  if (result.ok) throw new Error("expected rejection, got ok");
  return result;
}

describe("registry surface", () => {
  it("exposes the closed v1 vocabulary", () => {
    expect(ANALYSIS_VOCABULARY_VERSION).toBe("document-analyses/v1");
    expect(ANALYSIS_OPS).toEqual([
      "funnel_conversion",
      "ratio_pct",
      "variance_vs_prior",
      "group_count",
      "top_n",
      "trend",
    ]);
  });

  it("every op declares an input hint for the dispatch surface", () => {
    for (const op of ANALYSIS_OPS) {
      const spec = getAnalysisOp(op);
      expect(spec?.inputHint).toBeTruthy();
      expect(spec!.inputHint.length).toBeLessThan(80);
    }
  });

  it("rejects an unknown op listing available ops", () => {
    const rejected = expectRejected(
      computeAnalysis({ op: "median_absolute_deviation", inputs: {} }),
    );
    expect(rejected.diagnostics[0].code).toBe("ANALYSIS_UNKNOWN_OP");
    expect(rejected.diagnostics[0].message).toContain("funnel_conversion");
    expect(rejected.diagnostics[0].message).toContain("trend");
  });

  it("honors a caller-supplied diagnostic location", () => {
    const rejected = expectRejected(
      computeAnalysis({
        op: "funnel_conversion",
        inputs: {},
        location: "tw:analysis",
      }),
    );
    expect(rejected.diagnostics[0].location).toBe("tw:analysis");
  });
});

describe("funnel_conversion", () => {
  const stages = [
    { label: "Leads", count: 120 },
    { label: "Qualified", count: 80 },
    { label: "Proposal", count: 30 },
    { label: "Won", count: 12 },
  ];

  it("computes per-stage rates and overall (AE2)", () => {
    const ok = expectOk(
      computeAnalysis({ op: "funnel_conversion", inputs: { stages } }),
    );
    expect(ok.stats).toEqual([
      { label: "Leads → Qualified", value: "66.7%" },
      { label: "Qualified → Proposal", value: "37.5%" },
      { label: "Proposal → Won", value: "40%" },
      { label: "Overall conversion", value: "10%" },
    ]);
    expect(ok.series).toEqual([
      { label: "Leads", value: 120 },
      { label: "Qualified (66.7%)", value: 80 },
      { label: "Proposal (37.5%)", value: 30 },
      { label: "Won (40%)", value: 12 },
    ]);
    expect(ok.caption).toContain("10%");
  });

  it("rejects a single stage with the >=2 requirement and a corrected example (AE2)", () => {
    const rejected = expectRejected(
      computeAnalysis({
        op: "funnel_conversion",
        inputs: { stages: [{ label: "Leads", count: 120 }] },
      }),
    );
    expect(rejected.diagnostics[0].message).toContain("2–24");
    expect(rejected.diagnostics[0].message).toContain(
      "Corrected minimal example",
    );
  });

  it("rejects empty, non-numeric, and oversized stage lists", () => {
    expectRejected(
      computeAnalysis({ op: "funnel_conversion", inputs: { stages: [] } }),
    );
    expectRejected(
      computeAnalysis({
        op: "funnel_conversion",
        inputs: {
          stages: [
            { label: "A", count: "many" },
            { label: "B", count: 2 },
          ],
        },
      }),
    );
    const oversized = Array.from({ length: 25 }, (_, i) => ({
      label: `S${i}`,
      count: 25 - i,
    }));
    expectRejected(
      computeAnalysis({
        op: "funnel_conversion",
        inputs: { stages: oversized },
      }),
    );
  });

  it("reports n/a instead of dividing by a zero stage", () => {
    const ok = expectOk(
      computeAnalysis({
        op: "funnel_conversion",
        inputs: {
          stages: [
            { label: "A", count: 0 },
            { label: "B", count: 0 },
          ],
        },
      }),
    );
    expect(ok.stats).toEqual([
      { label: "A → B", value: "n/a" },
      { label: "Overall conversion", value: "n/a" },
    ]);
    for (const s of ok.stats) expect(s.value).not.toMatch(/NaN|Infinity/);
  });

  it("rejects negative counts", () => {
    expectRejected(
      computeAnalysis({
        op: "funnel_conversion",
        inputs: {
          stages: [
            { label: "A", count: 10 },
            { label: "B", count: -1 },
          ],
        },
      }),
    );
  });
});

describe("ratio_pct", () => {
  it("computes the percentage with a label", () => {
    const ok = expectOk(
      computeAnalysis({
        op: "ratio_pct",
        inputs: { numerator: 82, denominator: 100, label: "Quota attainment" },
      }),
    );
    expect(ok.stats).toEqual([{ label: "Quota attainment", value: "82%" }]);
    expect(ok.series).toEqual([{ label: "Quota attainment", value: 82 }]);
  });

  it("rejects a zero denominator (division guard)", () => {
    const rejected = expectRejected(
      computeAnalysis({
        op: "ratio_pct",
        inputs: { numerator: 5, denominator: 0 },
      }),
    );
    expect(rejected.diagnostics[0].message).toContain("nonzero");
  });

  it("rejects missing or non-numeric fields", () => {
    expectRejected(computeAnalysis({ op: "ratio_pct", inputs: {} }));
    expectRejected(
      computeAnalysis({
        op: "ratio_pct",
        inputs: { numerator: "eighty", denominator: 100 },
      }),
    );
  });
});

describe("variance_vs_prior", () => {
  it("computes delta and % change", () => {
    const ok = expectOk(
      computeAnalysis({
        op: "variance_vs_prior",
        inputs: { current: 118, prior: 104, label: "Closed-won" },
      }),
    );
    expect(ok.stats).toEqual([
      { label: "Closed-won (current)", value: "118" },
      { label: "Closed-won (prior)", value: "104" },
      { label: "Change", value: "+14" },
      { label: "Change %", value: "13.5%" },
    ]);
  });

  it("prior = 0 yields a defined result, never NaN/Infinity", () => {
    const ok = expectOk(
      computeAnalysis({
        op: "variance_vs_prior",
        inputs: { current: 7, prior: 0 },
      }),
    );
    const changePct = ok.stats.find((s) => s.label === "Change %");
    expect(changePct?.value).toBe("n/a (prior is 0)");
    for (const s of ok.stats) expect(s.value).not.toMatch(/NaN|Infinity/);
  });

  it("rejects non-numeric inputs", () => {
    expectRejected(
      computeAnalysis({
        op: "variance_vs_prior",
        inputs: { current: "up", prior: 3 },
      }),
    );
  });
});

describe("group_count", () => {
  it("counts per group, ordered count desc then label asc", () => {
    const ok = expectOk(
      computeAnalysis({
        op: "group_count",
        inputs: {
          values: ["Won", "Lost", "Won", "Open", "Won", "Lost"],
        },
      }),
    );
    expect(ok.series).toEqual([
      { label: "Won", value: 3 },
      { label: "Lost", value: 2 },
      { label: "Open", value: 1 },
    ]);
  });

  it("rejects empty, non-string, and oversized inputs", () => {
    expectRejected(
      computeAnalysis({ op: "group_count", inputs: { values: [] } }),
    );
    expectRejected(
      computeAnalysis({
        op: "group_count",
        inputs: { values: ["a", { nested: true }] },
      }),
    );
    expectRejected(
      computeAnalysis({
        op: "group_count",
        inputs: { values: Array.from({ length: 501 }, () => "x") },
      }),
    );
  });

  it("rejects more than 24 distinct groups, pointing at top_n", () => {
    const rejected = expectRejected(
      computeAnalysis({
        op: "group_count",
        inputs: { values: Array.from({ length: 25 }, (_, i) => `g${i}`) },
      }),
    );
    expect(rejected.diagnostics[0].message).toContain("top_n");
  });
});

describe("top_n", () => {
  const items = [
    { label: "Globex", value: 30500 },
    { label: "Acme", value: 42000 },
    { label: "Umbrella", value: 8000 },
    { label: "Initech", value: 12000 },
  ];

  it("returns the largest n by value, ties broken by label", () => {
    const ok = expectOk(
      computeAnalysis({ op: "top_n", inputs: { items, n: 2 } }),
    );
    expect(ok.series).toEqual([
      { label: "Acme", value: 42000 },
      { label: "Globex", value: 30500 },
    ]);
    const tied = expectOk(
      computeAnalysis({
        op: "top_n",
        inputs: {
          items: [
            { label: "B", value: 5 },
            { label: "A", value: 5 },
          ],
          n: 2,
        },
      }),
    );
    expect(tied.series.map((p) => p.label)).toEqual(["A", "B"]);
  });

  it("rejects bad n, empty items, non-numeric values, oversized lists", () => {
    expectRejected(computeAnalysis({ op: "top_n", inputs: { items, n: 0 } }));
    expectRejected(computeAnalysis({ op: "top_n", inputs: { items, n: 2.5 } }));
    expectRejected(
      computeAnalysis({ op: "top_n", inputs: { items: [], n: 3 } }),
    );
    expectRejected(
      computeAnalysis({
        op: "top_n",
        inputs: { items: [{ label: "A", value: "big" }], n: 1 },
      }),
    );
    expectRejected(
      computeAnalysis({
        op: "top_n",
        inputs: {
          items: Array.from({ length: 201 }, (_, i) => ({
            label: `x${i}`,
            value: i,
          })),
          n: 3,
        },
      }),
    );
  });
});

describe("trend", () => {
  const points = [
    { label: "Apr", value: 92 },
    { label: "May", value: 104 },
    { label: "Jun", value: 118 },
  ];

  it("reports direction and net change over ordered points", () => {
    const ok = expectOk(computeAnalysis({ op: "trend", inputs: { points } }));
    expect(ok.stats).toEqual([
      { label: "Direction", value: "up" },
      { label: "Net change", value: "+26" },
      { label: "Change %", value: "28.3%" },
    ]);
    expect(ok.series).toEqual(points);
  });

  it("flat and down directions", () => {
    const down = expectOk(
      computeAnalysis({
        op: "trend",
        inputs: {
          points: [
            { label: "a", value: 10 },
            { label: "b", value: 8 },
            { label: "c", value: 4 },
          ],
        },
      }),
    );
    expect(down.stats[0].value).toBe("down");
    const flat = expectOk(
      computeAnalysis({
        op: "trend",
        inputs: {
          points: [
            { label: "a", value: 5 },
            { label: "b", value: 9 },
            { label: "c", value: 5 },
          ],
        },
      }),
    );
    expect(flat.stats[0].value).toBe("flat");
  });

  it("enforces the 3-point floor, naming variance_vs_prior for pairs", () => {
    const rejected = expectRejected(
      computeAnalysis({
        op: "trend",
        inputs: { points: points.slice(0, 2) },
      }),
    );
    expect(rejected.diagnostics[0].message).toContain("variance_vs_prior");
  });

  it("rejects empty, non-numeric, and oversized point lists", () => {
    expectRejected(computeAnalysis({ op: "trend", inputs: { points: [] } }));
    expectRejected(
      computeAnalysis({
        op: "trend",
        inputs: {
          points: [
            { label: "a", value: 1 },
            { label: "b", value: "two" },
            { label: "c", value: 3 },
          ],
        },
      }),
    );
    expectRejected(
      computeAnalysis({
        op: "trend",
        inputs: {
          points: Array.from({ length: 25 }, (_, i) => ({
            label: `p${i}`,
            value: i,
          })),
        },
      }),
    );
  });

  it("first point 0 yields a defined change %, never NaN/Infinity", () => {
    const ok = expectOk(
      computeAnalysis({
        op: "trend",
        inputs: {
          points: [
            { label: "a", value: 0 },
            { label: "b", value: 3 },
            { label: "c", value: 6 },
          ],
        },
      }),
    );
    const changePct = ok.stats.find((s) => s.label === "Change %");
    expect(changePct?.value).toContain("n/a");
  });
});

describe("determinism", () => {
  it("identical inputs produce identical results across calls", () => {
    const inputs = {
      stages: [
        { label: "Leads", count: 120 },
        { label: "Won", count: 12 },
      ],
    };
    const a = computeAnalysis({ op: "funnel_conversion", inputs });
    const b = computeAnalysis({ op: "funnel_conversion", inputs });
    expect(a).toEqual(b);
  });
});
