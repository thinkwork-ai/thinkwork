/**
 * Document Compositor v2 (THINK-154 U2): directive engine — closed vocabulary,
 * strict YAML posture, model-actionable rejections with corrected examples
 * (R2/KTD7), and plate-class component output.
 */
import { describe, expect, it } from "vitest";
import { compileDocument } from "./document-compositor.js";
import {
  buildDirectiveEngine,
  makeChartSpec,
  renderDocumentDirective,
  type DirectiveSpec,
} from "./document-directives.js";
import { runDocumentPreflight } from "./document-preflight.js";

const genre = "report" as const;

describe("renderDocumentDirective", () => {
  it("AE1: unknown directive rejects naming the directive, the vocabulary, and a corrected example", () => {
    const result = renderDocumentDirective({
      kind: "hologram",
      body: "foo: 1",
      genre,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const d = result.diagnostics[0];
      expect(d.code).toBe("UNKNOWN_DIRECTIVE");
      expect(d.message).toContain('"tw:hologram"');
      expect(d.message).toContain("tw:stats");
      expect(d.message).toContain("tw:verdict-grid");
      expect(d.message).toContain("tw:chart");
      expect(d.message).toContain("```tw:stats");
    }
  });

  it("malformed YAML rejects with the parse error, the schema, and a corrected example", () => {
    const result = renderDocumentDirective({
      kind: "stats",
      body: "items: [unclosed",
      genre,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const d = result.diagnostics[0];
      expect(d.code).toBe("DIRECTIVE_INVALID");
      expect(d.message).toContain("failed to parse as YAML");
      expect(d.message).toContain("Expected schema:");
      expect(d.message).toContain("```tw:stats");
    }
  });

  it("tw:stats renders the plate stat-strip markup", () => {
    const result = renderDocumentDirective({
      kind: "stats",
      body: 'items:\n  - { value: 42, label: opportunities }\n  - { value: "+18%", label: change vs prior }',
      genre,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.containsSvg).toBe(false);
      expect(result.html).toContain('<div class="stats">');
      expect(result.html).toContain('<div class="n">42</div>');
      expect(result.html).toContain('<div class="l">change vs prior</div>');
    }
  });

  it("tw:stats escapes model-authored strings", () => {
    const result = renderDocumentDirective({
      kind: "stats",
      body: 'items:\n  - { value: "<script>x</script>", label: "a & b" }',
      genre,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).not.toContain("<script>");
      expect(result.html).toContain("&lt;script&gt;");
      expect(result.html).toContain("a &amp; b");
    }
  });

  it("tw:verdict-grid renders the plate card grid with tone pills", () => {
    const result = renderDocumentDirective({
      kind: "verdict-grid",
      body: "cards:\n  - { question: Ship it?, answer: Yes, note: All gates green, tone: acc }\n  - { question: Risk, answer: Low, tone: info }",
      genre,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain('<div class="cards">');
      expect(result.html).toContain('<div class="q">Ship it?</div>');
      expect(result.html).toContain('<span class="pill acc">Yes</span>');
      expect(result.html).toContain('<span class="pill info">Low</span>');
      expect(result.html).toContain("<p>All gates green</p>");
    }
  });

  it("rejects a directive not available for the document's genre, naming the restriction", () => {
    const restricted: DirectiveSpec = {
      kind: "report-only",
      genres: ["report"],
      schema: "n/a",
      example: "n/a",
      render: () => ({ ok: true, html: "<div></div>", containsSvg: false }),
    };
    const engine = buildDirectiveEngine([restricted]);
    const result = engine({ kind: "report-only", body: "{}", genre: "plan" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("DIRECTIVE_GENRE_RESTRICTED");
      expect(result.diagnostics[0].message).toContain('"plan"');
      expect(result.diagnostics[0].message).toContain("report");
    }
  });

  it("field-level validation failures name the offending entry", () => {
    const result = renderDocumentDirective({
      kind: "verdict-grid",
      body: "cards:\n  - { question: Only a question }",
      genre,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("cards[0]");
    }
  });
});

describe("tw:chart shell", () => {
  const VALID_CHART = `type: funnel
title: Pipeline by stage
series:
  - { label: Leads, value: 120 }
  - { label: Qualified, value: 64 }
caption: Qualification is the biggest drop-off.`;

  it("rejects unknown chart types naming the supported set", () => {
    const result = renderDocumentDirective({
      kind: "chart",
      body: "type: hologram\ntitle: T\nseries:\n  - { label: a, value: 1 }",
      genre,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("bar, line, donut");
      expect(result.diagnostics[0].message).toContain("funnel");
    }
  });

  it("rejects malformed series points with the index", () => {
    const result = renderDocumentDirective({
      kind: "chart",
      body: 'type: bar\ntitle: T\nseries:\n  - { label: a, value: 1 }\n  - { label: b, value: "many" }',
      genre,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("series[1]");
    }
  });

  it("rejects cleanly when constructed without a renderer", () => {
    const engine = buildDirectiveEngine([makeChartSpec(null)]);
    const result = engine({ kind: "chart", body: VALID_CHART, genre });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain("markdown table");
    }
  });

  it("production engine renders charts via the wired house renderer", () => {
    const result = renderDocumentDirective({
      kind: "chart",
      body: VALID_CHART,
      genre,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.containsSvg).toBe(true);
      expect(result.html).toContain("<svg ");
      expect(result.html).toContain("var(--accent)");
    }
  });

  it("with a renderer wired, emits figure + caption + details data table and flags SVG", () => {
    const engine = buildDirectiveEngine([
      makeChartSpec((data) => `<svg data-type="${data.type}"></svg>`),
    ]);
    const result = engine({ kind: "chart", body: VALID_CHART, genre });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.containsSvg).toBe(true);
      expect(result.html).toContain('<svg data-type="funnel"></svg>');
      expect(result.html).toContain(
        "<figcaption>Qualification is the biggest drop-off.</figcaption>",
      );
      expect(result.html).toContain("<summary>Chart data</summary>");
      expect(result.html).toContain("<td>Leads</td><td>120</td>");
    }
  });
});

describe("compositor + directives end-to-end", () => {
  it("non-SVG directive output passes the U1 sanitizer unchanged", () => {
    const result = compileDocument({
      genre,
      title: "Q3 Report",
      abstract: "With components.",
      markdownBody: `## Summary

\`\`\`tw:stats
items:
  - { value: 42, label: opportunities }
\`\`\`

\`\`\`tw:verdict-grid
cards:
  - { question: On track?, answer: Yes, tone: acc }
\`\`\`

Prose after components.
`,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.renderHtml).toContain(
        '<div class="stats"><div class="stat"><div class="n">42</div>',
      );
      expect(result.renderHtml).toContain('<span class="pill acc">Yes</span>');
      const preflight = runDocumentPreflight({
        renderHtml: result.renderHtml,
        digestMarkdown: "# d",
      });
      expect(preflight.ok).toBe(true);
    }
  });

  it("unknown directive inside a document is a compile rejection carrying the vocabulary (AE1)", () => {
    const result = compileDocument({
      genre,
      title: "T",
      abstract: "",
      markdownBody: "## Body\n\n```tw:pivot-table\nrows: []\n```\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("UNKNOWN_DIRECTIVE");
      expect(result.diagnostics[0].message).toContain(
        "tw:stats, tw:verdict-grid, tw:chart",
      );
    }
  });
});
