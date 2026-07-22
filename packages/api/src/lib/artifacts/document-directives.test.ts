/**
 * Document Compositor v2 (THINK-154 U2): directive engine — closed vocabulary,
 * strict YAML posture, model-actionable rejections with corrected examples
 * (R2/KTD7), and plate-class component output.
 */
import { describe, expect, it } from "vitest";
import { compileDocument } from "./document-compositor.js";
import { resolvePlatformPlate } from "./plate-registry.js";
import {
  buildDirectiveEngine,
  makeChartSpec,
  renderDocumentDirective,
  renderSourcesDirective,
  type DirectiveSpec,
} from "./document-directives.js";
import { runDocumentPreflight } from "./document-preflight.js";

const genre = "report" as const;
const plate = resolvePlatformPlate("report")!;

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
      expect(d.message).toContain("tw:timeline");
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

describe("tw:timeline", () => {
  it("renders a 3-item milestone track without SVG", () => {
    const result = renderDocumentDirective({
      kind: "timeline",
      body: `items:
  - { label: Kickoff, caption: Contract signed }
  - { label: Build, caption: Core implementation }
  - { label: Launch, caption: Public rollout }`,
      genre,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.containsSvg).toBe(false);
      expect(result.html).toContain('<div class="timeline">');
      expect(result.html.match(/class="t-item/g)).toHaveLength(3);
      expect(result.html).not.toContain("<svg");
    }
  });

  it("renders dates verbatim", () => {
    const result = renderDocumentDirective({
      kind: "timeline",
      body: `items:
  - { label: Launch, date: "Q3 '26" }`,
      genre,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("Q3 '26");
    }
  });

  it("marks exactly one current item and wraps the second item's label", () => {
    const result = renderDocumentDirective({
      kind: "timeline",
      body: `items:
  - { label: Kickoff }
  - { label: Build, current: true }
  - { label: Launch }
  - { label: Retrospective }`,
      genre,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html.match(/class="t-item current"/g)).toHaveLength(1);
      expect(result.html).toContain(
        '<div class="t-item current"><div class="t-label">Build</div>',
      );
    }
  });

  it("rejects a missing label with the offending index and corrected example", () => {
    const result = renderDocumentDirective({
      kind: "timeline",
      body: `items:
  - { label: Kickoff }
  - { caption: Missing label }`,
      genre,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("DIRECTIVE_INVALID");
      expect(result.diagnostics[0].message).toContain("items[1]");
      expect(result.diagnostics[0].message).toContain("```tw:timeline");
    }
  });

  it("rejects invalid item lists, bodies, duplicate current markers, and malformed YAML", () => {
    const cases = [
      {
        body: "items: []",
        checks: ["1-8 entries"],
      },
      {
        body: `items:
  - { label: "1" }
  - { label: "2" }
  - { label: "3" }
  - { label: "4" }
  - { label: "5" }
  - { label: "6" }
  - { label: "7" }
  - { label: "8" }
  - { label: "9" }`,
        checks: ["1-8 entries"],
      },
      {
        body: `items:
  - { label: Kickoff, current: true }
  - { label: Build }
  - { label: Launch, current: true }`,
        checks: ["items[0]", "items[2]"],
      },
      {
        body: "- a",
        checks: ["1-8 entries"],
      },
      {
        body: "items: [unclosed",
        checks: ["failed to parse as YAML"],
      },
    ];
    for (const c of cases) {
      const result = renderDocumentDirective({
        kind: "timeline",
        body: c.body,
        genre,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0].code).toBe("DIRECTIVE_INVALID");
        for (const check of c.checks) {
          expect(result.diagnostics[0].message).toContain(check);
        }
      }
    }
  });

  it("escapes model-authored labels", () => {
    const result = renderDocumentDirective({
      kind: "timeline",
      body: `items:
  - { label: "<b>x&y</b>" }`,
      genre,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("&lt;b&gt;x&amp;y&lt;/b&gt;");
      expect(result.html).not.toContain("<b>");
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
      plate,
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
      plate,
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

describe("tw:sources (per-section provenance)", () => {
  const SECTIONS = [
    {
      id: "pipeline-health",
      title: "Pipeline Health",
      tier: "required-if-material" as const,
    },
    { id: "summary", title: "Summary", tier: "required" as const },
  ];

  it("renders a compact sources card and collects the claims", () => {
    const result = renderSourcesDirective({
      body: [
        "section: pipeline-health",
        "- tool: mcp_lastmile-data_query — SELECT stage, count(*) FROM opportunity (12 rows)",
        "- tool: twenty--crm.search_records: opportunities for the rep (72 records)",
        "- none: closing narrative synthesized from the rows above",
      ].join("\n"),
      sections: SECTIONS,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain('class="card section-sources"');
      expect(result.html).toContain(
        '<span class="sources-label">Data sources</span>',
      );
      expect(result.html).toContain(
        "<code>mcp_lastmile-data_query</code> — SELECT stage, count(*) FROM opportunity (12 rows)",
      );
      expect(result.html).toContain("<code>twenty--crm.search_records</code>");
      expect(result.html).toContain(
        "No tool data — closing narrative synthesized from the rows above",
      );
      expect(result.sources).toEqual({
        sectionId: "pipeline-health",
        entries: [
          {
            kind: "tool",
            tool: "mcp_lastmile-data_query",
            detail: "SELECT stage, count(*) FROM opportunity (12 rows)",
          },
          {
            kind: "tool",
            tool: "twenty--crm.search_records",
            detail: "opportunities for the rep (72 records)",
          },
          {
            kind: "none",
            detail: "closing narrative synthesized from the rows above",
          },
        ],
      });
    }
  });

  it("HTML in tool names and details is escaped", () => {
    const result = renderSourcesDirective({
      body: 'section: summary\n- tool: some_tool — detail with <script>alert("x")</script>',
      sections: SECTIONS,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).not.toContain("<script>");
      expect(result.html).toContain("&lt;script&gt;");
    }
  });

  it("rejects a missing section line with the corrected example", () => {
    const result = renderSourcesDirective({
      body: "- tool: some_tool — a query",
      sections: SECTIONS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("DIRECTIVE_INVALID");
      expect(result.diagnostics[0].message).toContain("section:");
      expect(result.diagnostics[0].message).toContain("```tw:sources");
    }
  });

  it("rejects a section id outside the manifest, naming the manifest ids", () => {
    const result = renderSourcesDirective({
      body: "section: nonexistent\n- tool: some_tool — a query",
      sections: SECTIONS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].message).toContain(
        "pipeline-health, summary",
      );
    }
  });

  it("accepts any slug-shaped section when the plate has no manifest", () => {
    const result = renderSourcesDirective({
      body: "section: anything-goes\n- tool: some_tool — a query",
      sections: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects fences with no source lines, junk lines, empty none reasons, and oversize details", () => {
    const noLines = renderSourcesDirective({
      body: "section: summary",
      sections: SECTIONS,
    });
    expect(noLines.ok).toBe(false);

    const junk = renderSourcesDirective({
      body: "section: summary\njust some prose",
      sections: SECTIONS,
    });
    expect(junk.ok).toBe(false);
    if (!junk.ok) {
      expect(junk.diagnostics[0].message).toContain("- tool:");
      expect(junk.diagnostics[0].message).toContain("- none:");
    }

    const emptyNone = renderSourcesDirective({
      body: "section: summary\n- none:",
      sections: SECTIONS,
    });
    expect(emptyNone.ok).toBe(false);

    const oversize = renderSourcesDirective({
      body: `section: summary\n- tool: some_tool — ${"x".repeat(301)}`,
      sections: SECTIONS,
    });
    expect(oversize.ok).toBe(false);
    if (!oversize.ok) {
      expect(oversize.diagnostics[0].message).toContain("300");
    }
  });
});
