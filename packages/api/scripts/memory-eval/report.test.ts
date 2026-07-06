import { describe, expect, it } from "vitest";

import type { JudgeReport } from "./judge.js";
import {
  aggregateCandidate,
  buildMarkdownReport,
  parseArgs,
  worstUnits,
} from "./report.js";

function buildReport(overrides: Partial<JudgeReport> = {}): JudgeReport {
  return {
    candidate: "gpt-oss-20b-baseline",
    judgeModelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    promptVersion: "memory-judge-v1",
    generatedAt: "2026-07-01T00:00:00.000Z",
    documents: [
      {
        threadId: "thread-1",
        title: "Plan the launch",
        sourceCharCount: 400,
        units: [
          {
            unitId: "unit-1",
            text: "Eric prefers pnpm over npm.",
            referentComplete: 1,
            danglingReferents: [],
            faithful: 2,
            useful: 2,
            duplicateOf: null,
          },
          {
            unitId: "unit-2",
            text: "It was decided yesterday.",
            referentComplete: 0,
            danglingReferents: ["it"],
            faithful: 1,
            useful: 1,
            duplicateOf: null,
          },
          {
            unitId: "unit-3",
            text: "Eric prefers pnpm over npm.",
            referentComplete: 1,
            danglingReferents: [],
            faithful: 2,
            useful: 0,
            duplicateOf: "unit-1",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("requires --runs or --file", () => {
    expect(() => parseArgs([])).toThrow(/--runs .* or at least one --file/);
  });

  it("collects multiple --file flags", () => {
    const args = parseArgs([
      "--file",
      "a.json",
      "--file",
      "b.json",
      "--out",
      "o.md",
    ]);
    expect(args.files).toEqual(["a.json", "b.json"]);
    expect(args.out).toBe("o.md");
  });
});

describe("aggregateCandidate", () => {
  it("computes dangling/dup rates and mean scores", () => {
    const stats = aggregateCandidate(buildReport());
    expect(stats.candidate).toBe("gpt-oss-20b-baseline");
    expect(stats.documents).toBe(1);
    expect(stats.units).toBe(3);
    expect(stats.danglingReferentRate).toBeCloseTo(1 / 3);
    expect(stats.dupRate).toBeCloseTo(1 / 3);
    expect(stats.avgFaithful).toBeCloseTo((2 + 1 + 2) / 3);
    expect(stats.avgUseful).toBeCloseTo((2 + 1 + 0) / 3);
    expect(stats.unitsPerDoc).toBe(3);
  });

  it("handles an empty report without dividing by zero", () => {
    const stats = aggregateCandidate(buildReport({ documents: [] }));
    expect(stats.units).toBe(0);
    expect(stats.danglingReferentRate).toBe(0);
    expect(stats.dupRate).toBe(0);
    expect(stats.unitsPerDoc).toBe(0);
  });
});

describe("worstUnits", () => {
  it("ranks the lowest-composite units first", () => {
    const worst = worstUnits(buildReport(), 2);
    expect(worst).toHaveLength(2);
    // unit-2 (dangling referent, low faithful/useful) should rank worse than unit-1
    expect(worst[0].unitId).toBe("unit-2");
  });
});

describe("buildMarkdownReport", () => {
  it("renders a comparison table and a worst-units appendix", () => {
    const md = buildMarkdownReport([buildReport()]);
    expect(md).toContain("| Candidate | Docs | Units |");
    expect(md).toContain("gpt-oss-20b-baseline");
    expect(md).toContain("worst 10 units");
    expect(md).toContain("unit-2");
  });

  it("reports a placeholder for no scored runs", () => {
    expect(buildMarkdownReport([])).toContain("No scored runs found");
  });

  it("refuses to compare mismatched judge prompt versions", () => {
    const a = buildReport({ candidate: "a", promptVersion: "memory-judge-v1" });
    const b = buildReport({ candidate: "b", promptVersion: "memory-judge-v2" });
    expect(() => buildMarkdownReport([a, b])).toThrow(
      /mismatched judge prompt versions/,
    );
  });
});
