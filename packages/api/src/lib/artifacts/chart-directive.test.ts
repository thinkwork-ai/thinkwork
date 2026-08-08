/**
 * Document Compositor v2 (THINK-154 U3): house chart renderer — the seven
 * launch types render deterministic, scriptless, self-contained SVG in house
 * palette tokens, and every model-authored string is escaped at the renderer
 * boundary (AE2, R5, R6).
 */
import { describe, expect, it } from "vitest";
import { renderChart } from "@thinkwork/chart-renderer";
import { compileDocument } from "./document-compositor.js";
import { resolvePlatformPlate } from "./plate-registry.js";
import { CHART_TYPES, type ChartDirectiveData } from "./document-directives.js";
import { runDocumentPreflight } from "./document-preflight.js";

function chart(overrides: Partial<ChartDirectiveData>): ChartDirectiveData {
  return {
    type: "bar",
    title: "Pipeline by stage",
    qualifier: "count of opportunities",
    series: [
      { label: "Q1", value: 12 },
      { label: "Q2", value: 18 },
      { label: "Q3", value: 27 },
      { label: "Q4", value: 35 },
    ],
    ...overrides,
  };
}

/** No unescaped ampersands, no stray angle brackets inside text content. */
function expectWellFormed(svg: string): void {
  expect(svg).toMatch(/^<svg viewBox="0 0 \d+ \d+(\.\d+)?" role="img"/);
  expect(svg.endsWith("</svg>")).toBe(true);
  expect(svg).not.toMatch(/&(?!(amp|lt|gt|quot|#39);)/);
  expect(svg).not.toContain("NaN");
  expect(svg).not.toContain("Infinity");
  expect(svg).not.toContain("undefined");
}

describe("renderChart", () => {
  it("AE2: funnel renders a scriptless, self-contained, token-driven SVG", () => {
    const svg = renderChart(
      chart({
        type: "funnel",
        series: [
          { label: "Leads", value: 120 },
          { label: "Qualified", value: 64 },
          { label: "Won", value: 18 },
        ],
      }),
    );
    expectWellFormed(svg);
    expect(svg).toContain('fill="var(--accent)"');
    expect(svg).toContain('fill="var(--ink)"');
    expect(svg).toContain("Leads");
    expect(svg).toContain("53%"); // 64/120 conversion vs the first stage
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("http");
  });

  it("renders every launch type deterministically", () => {
    for (const type of CHART_TYPES) {
      const data = chart({ type, max: type === "meter" ? 50 : undefined });
      const a = renderChart(data);
      const b = renderChart(data);
      expect(a, type).toBe(b);
      expectWellFormed(a);
      expect(a, type).toContain("var(--");
    }
  });

  it("single-datum and all-zero series render degenerate-but-valid SVG", () => {
    for (const type of CHART_TYPES) {
      const single = renderChart(
        chart({ type, series: [{ label: "only", value: 0 }] }),
      );
      expectWellFormed(single);
      const zeros = renderChart(
        chart({
          type,
          series: [
            { label: "a", value: 0 },
            { label: "b", value: 0 },
          ],
        }),
      );
      expectWellFormed(zeros);
    }
  });

  it("value extremes keep direct labels inside the viewBox", () => {
    const svg = renderChart(
      chart({
        type: "bar",
        series: [
          { label: "tiny", value: 0 },
          { label: "huge", value: 12_345_678 },
        ],
      }),
    );
    expectWellFormed(svg);
    expect(svg).toContain("12,345,678");
    for (const m of svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0);
      expect(Number(m[1])).toBeLessThanOrEqual(720);
      expect(Number(m[2])).toBeGreaterThanOrEqual(0);
      expect(Number(m[2])).toBeLessThanOrEqual(250);
    }
  });

  it("escapes adversarial labels — markup renders as literal text", () => {
    const svg = renderChart(
      chart({
        type: "bar",
        title: "</svg><script>alert(1)</script>",
        qualifier: 'quote " in attribute context',
        series: [
          { label: "a & b", value: 3 },
          { label: "]]>", value: 5 },
          { label: "<img src=x onerror=alert(1)>", value: 7 },
        ],
      }),
    );
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("a &amp; b");
    expect(svg).toContain("]]&gt;");
    expectWellFormed(svg);
    // Exactly one closing </svg>: the injected one is escaped.
    expect(svg.match(/<\/svg>/g)).toHaveLength(1);
  });

  it("meter respects max and clamps overflow", () => {
    const svg = renderChart(
      chart({
        type: "meter",
        series: [{ label: "storage used", value: 130 }],
        max: 100,
      }),
    );
    expectWellFormed(svg);
    expect(svg).toContain("130");
    expect(svg).toContain("/ 100");
  });
});

describe("charts embedded in a compiled document", () => {
  it("a document with each chart type compiles and passes full DocSpector (R6)", () => {
    const fences = CHART_TYPES.map(
      (type) => `\`\`\`tw:chart
type: ${type}
title: ${type} example
${type === "meter" ? "max: 100\n" : ""}series:
  - { label: Alpha, value: 12 }
  - { label: Beta, value: 30 }
caption: ${type} takeaway.
\`\`\``,
    ).join("\n\n");
    const result = compileDocument({
      plate: resolvePlatformPlate("report")!,
      title: "Chart gallery",
      abstract: "All seven launch chart types.",
      markdownBody: `## Charts\n\n${fences}\n`,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.renderHtml.match(/<svg /g)?.length).toBe(
        CHART_TYPES.length,
      );
      const preflight = runDocumentPreflight({
        renderHtml: result.renderHtml,
        digestMarkdown: "# d",
      });
      if (!preflight.ok) {
        throw new Error(
          preflight.diagnostics
            .map((d) => `[${d.code}] ${d.location}: ${d.message}`)
            .join("\n"),
        );
      }
      expect(preflight.ok).toBe(true);
    }
  });
});
