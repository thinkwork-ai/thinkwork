/**
 * Document Compositor v2 (THINK-154 U1): the compiler is the enforcement
 * boundary — these tests prove no model-authored byte reaches the render,
 * output is deterministic, and every genre's compiled output passes the
 * DocSpector preflight the emission path retains (R6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compileDocument,
  resolveInternalWikiHref,
  stripLeadingFrontmatter,
  type CompositorPlate,
  type DirectiveEngine,
} from "./document-compositor.js";
import { runDocumentPreflight } from "./document-preflight.js";
import { DOCUMENT_PLATE_CSS } from "./document-templates.js";
import { CORE_PLATE_SLUGS } from "./plate-definitions.js";
import { resolvePlatformPlate } from "./plate-registry.js";

const REPORT_PLATE = resolvePlatformPlate("report")!;

const REPORT_MARKDOWN = `---
eyebrow: REPORT · Q3
date: 2026-07-05
context: coverage of the Q3 pipeline
---

## Summary

Pipeline value grew 18% quarter over quarter. Three opportunities need action.

## Findings

The largest movement came from the enterprise segment.

| Item | Value | Change |
| --- | --- | --- |
| Enterprise | 42 | +18% |
| Mid-market | 17 | -2% |

## Recommendations

1. Follow up on the three stalled opportunities.
2. Re-run the forecast after the renewals close.
`;

function compileOk(
  markdownBody: string,
  overrides: Partial<Parameters<typeof compileDocument>[0]> = {},
  engine?: DirectiveEngine,
) {
  const result = compileDocument(
    {
      plate: REPORT_PLATE,
      title: "Q3 Pipeline — Report",
      abstract: "Pipeline grew 18%; three opportunities need action.",
      markdownBody,
      ...overrides,
    },
    engine,
  );
  if (!result.ok) {
    throw new Error(
      `compile failed:\n${result.diagnostics.map((d) => `  [${d.code}] ${d.message}`).join("\n")}`,
    );
  }
  return result;
}

describe("compileDocument", () => {
  it("compiles a representative report onto the house plate", () => {
    const { renderHtml } = compileOk(REPORT_MARKDOWN);
    expect(renderHtml).toContain('<meta name="tw-plate" content="report">');
    expect(renderHtml).toContain(":root{");
    expect(renderHtml).toContain('<div class="eyebrow">REPORT · Q3</div>');
    expect(renderHtml).toContain(
      '<h1 id="doc-title">Q3 Pipeline — Report</h1>',
    );
    expect(renderHtml).toContain('<h2 id="summary">Summary</h2>');
    expect(renderHtml).toContain('<table class="data">');
    expect(renderHtml).toContain("composition-signal");
    expect(renderHtml).toContain("<strong>date</strong> 2026-07-05");
  });

  // THINK-227 U8 (R8): the house render prints cleanly — the share page
  // serves this exact document, so print-to-PDF needs no extra work.
  it("ships the print stylesheet in every compiled render", () => {
    const { renderHtml } = compileOk(REPORT_MARKDOWN);
    expect(renderHtml).toContain("@page{margin:18mm 16mm}");
    expect(renderHtml).toContain("@media print{");
    expect(renderHtml).toContain("break-inside:avoid");
    expect(renderHtml).toContain("break-after:avoid");
  });

  it("is deterministic: same input compiles byte-identical", () => {
    const a = compileOk(REPORT_MARKDOWN).renderHtml;
    const b = compileOk(REPORT_MARKDOWN).renderHtml;
    expect(a).toBe(b);
  });

  it("compiled output passes DocSpector for every core plate (R6)", () => {
    for (const genre of CORE_PLATE_SLUGS) {
      const { renderHtml } = compileOk(REPORT_MARKDOWN, {
        plate: resolvePlatformPlate(genre)!,
      });
      const preflight = runDocumentPreflight({
        renderHtml,
        digestMarkdown: REPORT_MARKDOWN,
      });
      if (!preflight.ok) {
        throw new Error(
          `${genre} failed preflight:\n${preflight.diagnostics
            .map((d) => `  [${d.code}] ${d.location}: ${d.message}`)
            .join("\n")}`,
        );
      }
      expect(preflight.ok).toBe(true);
    }
  });

  it("compiles tw:timeline onto the report plate and preserves sanitizer-safe classes", () => {
    const result = compileDocument({
      plate: REPORT_PLATE,
      title: "Launch — Report",
      abstract: "Milestone sequence.",
      markdownBody: `## Timeline

\`\`\`tw:timeline
items:
  - { label: Kickoff, caption: Contract signed }
  - { label: Build, caption: Core implementation, current: true }
  - { label: Launch, date: Q4 }
\`\`\`
`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.renderHtml).toContain('<div class="timeline">');
    expect(result.renderHtml).toContain('class="t-item current"');
    expect(result.renderHtml).toContain("t-dot");
    expect(result.renderHtml).toContain(".timeline{");
    const preflight = runDocumentPreflight({
      renderHtml: result.renderHtml,
      digestMarkdown: "# d",
    });
    expect(preflight.ok).toBe(true);
  });

  it("recovers a tw directive marker placed on the first line of an untyped fence", () => {
    const plate: CompositorPlate = {
      ...REPORT_PLATE,
      sections: [
        {
          id: "pipeline-health",
          title: "Pipeline Health",
          tier: "required",
          guidance: "Render the ordered pipeline funnel.",
        },
      ],
      analyses: [
        {
          key: "pipeline-conversion",
          op: "funnel_conversion",
          presentation: { directive: "chart", chartType: "funnel" },
        },
      ],
    };
    const result = compileDocument({
      plate,
      title: "Sales Rep Review",
      abstract: "Pipeline health.",
      markdownBody: `## Pipeline Health

\`\`\`
tw:analysis
analysis: pipeline-conversion
stages:
  - { label: NEW, count: 9 }
  - { label: PROSPECT, count: 4 }
  - { label: WON, count: 1 }
\`\`\`
`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.renderHtml).toContain("Pipeline conversion");
    expect(result.renderHtml).toContain("<svg");
    expect(result.renderHtml).not.toContain("tw:analysis");
    expect(result.sectionFacts?.analyses).toEqual([
      {
        key: "pipeline-conversion",
        computed: true,
        sectionId: "pipeline-health",
      },
    ]);
  });

  it("timeline track segments span the item's horizontal padding so adjacent segments meet (THINK-205 repair)", () => {
    // R5/AE1: the row must read as ONE continuous line through all dots. Each
    // item draws its own segment inside .t-track, but .t-item carries
    // horizontal padding — unless the segment extends across that padding on
    // both sides, adjacent segments stop short and the track shows gaps.
    const cssRule = (selector: string) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = DOCUMENT_PLATE_CSS.match(
        new RegExp(`(?:^|\\n|\\})${escaped}\\{([^}]*)\\}`),
      );
      expect(match, `missing CSS rule ${selector}`).not.toBeNull();
      return match![1];
    };
    const pxValue = (decl: string, prop: string) => {
      const match = decl.match(
        new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)(?:px)?(?:;|$)`),
      );
      return match ? Number(match[1]) : null;
    };
    const itemPadding =
      cssRule(".timeline .t-item").match(/padding:0 ([\d.]+)px/)?.[1] ?? "0";
    const track = cssRule(".timeline .t-track::before");
    expect(pxValue(track, "left")).toBeLessThanOrEqual(-Number(itemPadding));
    expect(pxValue(track, "right")).toBeLessThanOrEqual(-Number(itemPadding));
    // End-trim stays: the outer halves are still cut at the first/last dot.
    expect(cssRule(".timeline .t-item:first-child .t-track::before")).toContain(
      "left:50%",
    );
    expect(cssRule(".timeline .t-item:last-child .t-track::before")).toContain(
      "right:50%",
    );
  });

  it("drops unknown frontmatter keys with a warning naming the allowed set (KTD7)", () => {
    const result = compileOk(
      `---\neyebrow: WEEKLY\nbanana: split\n---\n\n## Body\n\nText.\n`,
    );
    expect(result.renderHtml).toContain('<div class="eyebrow">WEEKLY</div>');
    expect(result.renderHtml).not.toContain("banana");
    const warning = result.warnings.find(
      (w) => w.code === "FRONTMATTER_UNKNOWN_KEY",
    );
    expect(warning?.message).toContain('"banana"');
    expect(warning?.message).toContain("eyebrow, date, context");
  });

  it("warns and drops malformed frontmatter without rejecting", () => {
    const result = compileOk(
      `---\neyebrow: [unclosed\n---\n\n## Body\n\nText.\n`,
    );
    expect(result.warnings.some((w) => w.code === "FRONTMATTER_INVALID")).toBe(
      true,
    );
    expect(result.renderHtml).toContain('<h2 id="body">Body</h2>');
  });

  it("parses frontmatter preceded by leading blank lines (no setext-heading leak)", () => {
    const result = compileOk(
      `\n\n---\neyebrow: WEEKLY\n---\n\n## Body\n\nText.\n`,
    );
    expect(result.renderHtml).toContain('<div class="eyebrow">WEEKLY</div>');
    // The frontmatter must never fall through to the markdown renderer,
    // where the closing --- turns the keys into a setext heading.
    expect(result.renderHtml).not.toContain("eyebrow: WEEKLY");
  });

  it("parses frontmatter preceded by leading spaces", () => {
    const result = compileOk(
      `  ---\neyebrow: WEEKLY\n---\n\n## Body\n\nText.\n`,
    );
    expect(result.renderHtml).toContain('<div class="eyebrow">WEEKLY</div>');
    expect(result.renderHtml).not.toContain("eyebrow: WEEKLY");
  });

  it("leaves bodies without frontmatter unchanged", () => {
    const markdown = `## Body\n\nText.\n`;
    const result = compileOk(markdown);
    expect(result.renderHtml).toContain('<h2 id="body">Body</h2>');
    expect(stripLeadingFrontmatter(markdown)).toBe(markdown);
  });

  it("stripLeadingFrontmatter tolerates the same leading whitespace as the parser", () => {
    expect(
      stripLeadingFrontmatter(`\n\n---\neyebrow: WEEKLY\n---\n## Body\n`),
    ).toBe("## Body\n");
    expect(
      stripLeadingFrontmatter(`  ---\neyebrow: WEEKLY\n---\n## Body\n`),
    ).toBe("## Body\n");
  });

  it("strips raw <script> and external <img>, and output still passes preflight", () => {
    const result = compileOk(
      `## Body\n\n<script>alert(1)</script>\n\nSome prose.\n\n<img src="https://evil.example/x.png">\n\nMore prose.\n`,
    );
    expect(result.renderHtml).not.toContain("<script");
    expect(result.renderHtml).not.toContain("evil.example");
    expect(result.warnings.some((w) => w.code === "RAW_HTML_STRIPPED")).toBe(
      true,
    );
    const preflight = runDocumentPreflight({
      renderHtml: result.renderHtml,
      digestMarkdown: "# d",
    });
    expect(preflight.ok).toBe(true);
  });

  it("converts external markdown links and images to inert text", () => {
    const result = compileOk(
      `## Body\n\nSee [the docs](https://example.com/docs) and ![diagram](https://example.com/d.png).\n\nAnchor [to summary](#summary) survives.\n`,
    );
    expect(result.renderHtml).not.toContain('href="https://example.com/docs"');
    expect(result.renderHtml).toContain(
      "the docs (<code>https://example.com/docs</code>)",
    );
    expect(result.renderHtml).toContain('<a href="#summary">to summary</a>');
    expect(result.renderHtml).not.toContain("<img");
    expect(result.renderHtml).toContain("diagram");
  });

  it("SVG wall: raw inline <svg> is stripped while directive SVG is injected after sanitize (KTD4)", () => {
    const engine: DirectiveEngine = ({ kind }) =>
      kind === "chart"
        ? {
            ok: true,
            html: '<figure><svg viewBox="0 0 10 10"><rect fill="var(--accent)"/></svg></figure>',
            containsSvg: true,
          }
        : {
            ok: false,
            diagnostics: [
              { code: "UNKNOWN_DIRECTIVE", message: "no", location: kind },
            ],
          };
    const result = compileOk(
      `## Body\n\n<svg onload="alert(1)"><script>x</script></svg>\n\n\`\`\`tw:chart\ntype: bar\n\`\`\`\n`,
      {},
      engine,
    );
    expect(result.renderHtml).not.toContain("onload");
    expect(result.renderHtml).not.toContain("<script");
    expect(result.renderHtml).toContain('<svg viewBox="0 0 10 10">');
    expect(result.renderHtml).toContain('fill="var(--accent)"');
  });

  it("placeholder integrity: literal placeholder-shaped text is not substituted", () => {
    const engine: DirectiveEngine = () => ({
      ok: true,
      html: "<figure><svg><rect/></svg></figure>",
      containsSvg: true,
    });
    const literal = "tw-directive-slot-aaaaaaaaaaaaaaaaaaaaaaaa-0";
    const result = compileOk(
      `## Body\n\nThe token ${literal} is plain text.\n\n\`\`\`tw:chart\ntype: bar\n\`\`\`\n`,
      {},
      engine,
    );
    // The literal text survives as text; only the real slot got SVG.
    expect(result.renderHtml).toContain(literal);
    expect(result.renderHtml.match(/<svg/g)).toHaveLength(1);
  });

  it("rejects tw: fences with a model-actionable diagnostic when no engine component matches (R2)", () => {
    const result = compileDocument({
      plate: REPORT_PLATE,
      title: "T",
      abstract: "",
      markdownBody: "## Body\n\n```tw:hologram\nfoo: 1\n```\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("UNKNOWN_DIRECTIVE");
      expect(result.diagnostics[0].message).toContain("tw:hologram");
    }
  });

  it("escapes model-authored title/abstract/frontmatter into the shell", () => {
    const result = compileOk("## Body\n\nText.\n", {
      title: "<script>alert(1)</script> & Co",
      abstract: '"quoted" <b>abstract</b>',
    });
    expect(result.renderHtml).not.toContain("<script>");
    expect(result.renderHtml).toContain("&lt;script&gt;");
    expect(result.renderHtml).toContain("&amp; Co");
    expect(result.renderHtml).not.toContain("<b>abstract</b>");
  });

  it("demotes markdown h1 to h2 (the shell owns the document H1)", () => {
    const result = compileOk("# Top\n\nText.\n");
    expect(result.renderHtml).toContain('<h2 id="top">Top</h2>');
    expect(result.renderHtml.match(/<h1\b/g)).toHaveLength(1);
  });
});

describe("golden parity (THINK-153 U2)", () => {
  // Fixtures were generated by the PRE-registry compositor (hardcoded genre
  // enum + GENRE_TEMPLATES). An uncustomized core plate must compile
  // byte-identical output — the registry changes nothing until a tenant does.
  const fixturesDir = join(
    fileURLToPath(new URL(".", import.meta.url)),
    "__fixtures__",
  );
  const GOLDEN_BODY = readFileSync(join(fixturesDir, "golden-body.md"), "utf8");

  it("core plates with no tenant customization compile byte-identical to pre-registry output", () => {
    for (const slug of CORE_PLATE_SLUGS) {
      const golden = readFileSync(
        join(fixturesDir, `golden-${slug}.html`),
        "utf8",
      );
      const result = compileDocument({
        plate: resolvePlatformPlate(slug)!,
        title: `Golden ${slug}`,
        abstract: `Abstract for ${slug}.`,
        markdownBody: GOLDEN_BODY,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.renderHtml).toBe(golden);
    }
  });
});

describe("plate-driven compilation (THINK-153)", () => {
  const tenantPlate: CompositorPlate = {
    slug: "board-update",
    eyebrow: "BOARD UPDATE",
    tokensLight: { "--accent": "#334455", "--accent-soft": "#e2e6ea" },
    tokensDark: { "--accent": "#9db2c6" },
    allowedDirectives: ["stats"],
  };

  it("tenant plate compiles with its eyebrow and palette in the output HTML", () => {
    const result = compileOk("## Body\n\nText.\n", { plate: tenantPlate });
    expect(result.renderHtml).toContain(
      '<meta name="tw-plate" content="board-update">',
    );
    expect(result.renderHtml).toContain(
      '<div class="eyebrow">BOARD UPDATE</div>',
    );
    expect(result.renderHtml).toContain("--accent:#334455;");
    // Dark values land in BOTH the media query and the data-theme block.
    expect(result.renderHtml).toContain("--accent:#9db2c6;");
    expect(result.renderHtml).toContain(':root[data-theme="dark"]');
    expect(result.renderHtml).toContain("prefers-color-scheme: light");
    const preflight = runDocumentPreflight({
      renderHtml: result.renderHtml,
      digestMarkdown: "# d",
    });
    expect(preflight.ok).toBe(true);
  });

  it("plate excluding a directive rejects it with DIRECTIVE_GENRE_RESTRICTED (AE4/KTD8)", () => {
    const result = compileDocument({
      plate: tenantPlate,
      title: "T",
      abstract: "",
      markdownBody:
        "## Body\n\n```tw:chart\ntype: bar\ntitle: X\nseries:\n  - { label: A, value: 1 }\n```\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("DIRECTIVE_GENRE_RESTRICTED");
      expect(result.diagnostics[0].message).toContain("board-update");
      expect(result.diagnostics[0].message).toContain("tw:stats");
    }
    const allowed = compileDocument({
      plate: tenantPlate,
      title: "T",
      abstract: "",
      markdownBody:
        "## Body\n\n```tw:stats\nitems:\n  - { value: 1, label: a }\n```\n",
    });
    expect(allowed.ok).toBe(true);
  });

  it("plate excluding timeline rejects it with DIRECTIVE_GENRE_RESTRICTED (AE5)", () => {
    const result = compileDocument({
      plate: tenantPlate,
      title: "T",
      abstract: "",
      markdownBody:
        "## Body\n\n```tw:timeline\nitems:\n  - { label: Kickoff }\n  - { label: Build, current: true }\n  - { label: Launch }\n```\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("DIRECTIVE_GENRE_RESTRICTED");
    }
  });
});

describe("tw:analysis — server-computed analyses (THINK-183 U3)", () => {
  const ANALYSES = [
    {
      key: "pipeline-conversion",
      op: "funnel_conversion",
      presentation: { directive: "chart", chartType: "funnel" as const },
    },
    {
      key: "quota-attainment",
      op: "ratio_pct",
      presentation: { directive: "stats" },
    },
  ];
  const ANALYSIS_PLATE: CompositorPlate = {
    ...REPORT_PLATE,
    analyses: ANALYSES,
  };
  const FUNNEL_BLOCK = `\`\`\`tw:analysis
analysis: pipeline-conversion
stages:
  - { label: Leads, count: 120 }
  - { label: Qualified, count: 80 }
  - { label: Proposal, count: 30 }
  - { label: Won, count: 12 }
\`\`\``;
  const DIGEST = `## Summary

Pipeline narrative narrated from computed numbers.

${FUNNEL_BLOCK}

## Recommendations

Keep qualifying harder.
`;

  it("compiles a funnel_conversion block with server-computed rates in the render (AE2)", () => {
    const result = compileDocument({
      plate: ANALYSIS_PLATE,
      title: "Pipeline — Report",
      abstract: "Computed funnel.",
      markdownBody: DIGEST,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Server-computed transition rates appear (labels in SVG + fallback table).
    expect(result.renderHtml).toContain("66.7%");
    expect(result.renderHtml).toContain("37.5%");
    expect(result.renderHtml).toContain("Overall conversion 10%");
    expect(result.renderHtml).toContain(
      "<details><summary>Chart data</summary>",
    );
    const preflight = runDocumentPreflight({
      renderHtml: result.renderHtml,
      digestMarkdown: DIGEST,
    });
    expect(preflight.ok).toBe(true);
  });

  it("model-authored numbers cannot leak: extraneous fields are ignored, rendered values are computed", () => {
    const digest = `## Summary

\`\`\`tw:analysis
analysis: pipeline-conversion
rates: [99, 98, 97]
stages:
  - { label: Leads, count: 120 }
  - { label: Won, count: 12 }
\`\`\`
`;
    const result = compileDocument({
      plate: ANALYSIS_PLATE,
      title: "Pipeline — Report",
      abstract: "x",
      markdownBody: digest,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.renderHtml).toContain("10%");
    expect(result.renderHtml).not.toContain("99%");
  });

  it("a stats-presented analysis renders computed stat tiles", () => {
    const digest = `## Summary

\`\`\`tw:analysis
analysis: quota-attainment
numerator: 82
denominator: 100
label: Quota attainment
\`\`\`
`;
    const result = compileDocument({
      plate: ANALYSIS_PLATE,
      title: "Rep — Report",
      abstract: "x",
      markdownBody: digest,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.renderHtml).toContain('<div class="stats">');
    expect(result.renderHtml).toContain("82%");
  });

  it("unknown analysis key rejects, listing the plate's declared keys", () => {
    const digest = `\`\`\`tw:analysis
analysis: churn-rate
stages:
  - { label: A, count: 2 }
  - { label: B, count: 1 }
\`\`\``;
    const result = compileDocument({
      plate: ANALYSIS_PLATE,
      title: "t",
      abstract: "a",
      markdownBody: digest,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].message).toContain("pipeline-conversion");
    expect(result.diagnostics[0].message).toContain("quota-attainment");
  });

  it("raw inputs failing the op's shape reject with the op diagnostic and corrected example", () => {
    const digest = `\`\`\`tw:analysis
analysis: pipeline-conversion
stages:
  - { label: Leads, count: 120 }
\`\`\``;
    const result = compileDocument({
      plate: ANALYSIS_PLATE,
      title: "t",
      abstract: "a",
      markdownBody: digest,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].message).toContain("2–24");
    expect(result.diagnostics[0].message).toContain(
      "Corrected minimal example",
    );
    expect(result.diagnostics[0].location).toBe("tw:analysis");
  });

  it("tw:analysis on a plate declaring no analyses rejects saying so (AE4-adjacent)", () => {
    const result = compileDocument({
      plate: REPORT_PLATE,
      title: "t",
      abstract: "a",
      markdownBody: DIGEST,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].message).toContain("declares no analyses");
  });

  it("a plate with analyses but no manifest can still use tw:analysis (contract halves independent)", () => {
    const plate: CompositorPlate = { ...REPORT_PLATE, analyses: ANALYSES };
    expect(plate.sections).toBeUndefined();
    const result = compileDocument({
      plate,
      title: "t",
      abstract: "a",
      markdownBody: DIGEST,
    });
    expect(result.ok).toBe(true);
  });

  it("tw:analysis bypasses a restricted allowedDirectives list (KTD11 structural directive)", () => {
    const proposalShaped: CompositorPlate = {
      ...REPORT_PLATE,
      slug: "proposal",
      allowedDirectives: ["stats", "verdict-grid"],
      analyses: [
        {
          key: "quota-attainment",
          op: "ratio_pct",
          presentation: { directive: "stats" },
        },
      ],
    };
    const digest = `## Summary

\`\`\`tw:analysis
analysis: quota-attainment
numerator: 3
denominator: 4
\`\`\`
`;
    const result = compileDocument({
      plate: proposalShaped,
      title: "t",
      abstract: "a",
      markdownBody: digest,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.renderHtml).toContain("75%");
    // The plate gate still applies to ordinary directives.
    const chartResult = compileDocument({
      plate: proposalShaped,
      title: "t",
      abstract: "a",
      markdownBody:
        "```tw:chart\ntype: bar\ntitle: x\nseries:\n  - { label: a, value: 1 }\n```",
    });
    expect(chartResult.ok).toBe(false);
  });

  it("plate-declared params win over model-supplied inputs", () => {
    const plate: CompositorPlate = {
      ...REPORT_PLATE,
      analyses: [
        {
          key: "top-accounts",
          op: "top_n",
          params: { n: 1 },
          presentation: { directive: "chart", chartType: "bar" },
        },
      ],
    };
    const digest = `\`\`\`tw:analysis
analysis: top-accounts
n: 24
items:
  - { label: Acme, value: 10 }
  - { label: Globex, value: 20 }
\`\`\``;
    const result = compileDocument({
      plate,
      title: "t",
      abstract: "a",
      markdownBody: digest,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.renderHtml).toContain("Globex");
    // n: 1 (plate param) beat n: 24 (model input) — only one row in the table.
    expect(result.renderHtml).not.toMatch(/<td>Acme<\/td>/);
  });
});

describe("tw:waiver + section enforcement (THINK-183 U4)", () => {
  const MANIFEST_PLATE: CompositorPlate = {
    ...REPORT_PLATE,
    sections: [
      {
        id: "pipeline-health",
        title: "Pipeline Health",
        tier: "required-if-material",
        guidance: "Stage-by-stage funnel with conversion rates.",
        suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
      },
      {
        id: "quota-attainment",
        title: "Quota Attainment",
        tier: "required",
        guidance: "Attainment vs target for the period.",
      },
      {
        id: "coaching-notes",
        title: "Coaching Notes",
        tier: "suggested",
        guidance: "Specific behaviors to keep or change.",
      },
    ],
  };
  const QUOTA_SECTION = `## Quota Attainment

Attainment held at 82% of target.`;
  const PIPELINE_SECTION = `## Pipeline Health

Funnel narrative goes here.`;
  const WAIVER_BLOCK = `\`\`\`tw:waiver
section: pipeline-health
reason: No stage-level pipeline data is connected for this rep.
\`\`\``;

  function compileWith(markdownBody: string, plate = MANIFEST_PLATE) {
    return compileDocument({
      plate,
      title: "Rep Review — Report",
      abstract: "Representative review.",
      markdownBody,
    });
  }

  it("silent omission of a required section rejects, naming section, guidance, and suggested directives (AE1/F3)", () => {
    const result = compileWith(`${QUOTA_SECTION}\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const d = result.diagnostics[0];
    expect(d.code).toBe("REQUIRED_SECTION_MISSING");
    expect(d.location).toBe("section:pipeline-health");
    expect(d.message).toContain("Pipeline Health");
    expect(d.message).toContain("Stage-by-stage funnel");
    expect(d.message).toContain("tw:chart (funnel)");
    expect(d.message).toContain("tw:waiver");
  });

  it("an explicit waiver passes: omission notice in place, footer line, waiver on the result (F2)", () => {
    const result = compileWith(`${QUOTA_SECTION}\n\n${WAIVER_BLOCK}\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.waivers).toEqual([
      {
        sectionId: "pipeline-health",
        title: "Pipeline Health",
        tier: "required-if-material",
        reason: "No stage-level pipeline data is connected for this rep.",
      },
    ]);
    expect(result.renderHtml).toContain("Section omitted");
    expect(result.renderHtml).toContain(
      "Section waived: Pipeline Health — No stage-level pipeline data",
    );
    const preflight = runDocumentPreflight({
      renderHtml: result.renderHtml,
      digestMarkdown: QUOTA_SECTION,
    });
    expect(preflight.ok).toBe(true);
  });

  it("authoring the manifest title satisfies the check; a different heading slug does not", () => {
    const good = compileWith(`${QUOTA_SECTION}\n\n${PIPELINE_SECTION}\n`);
    expect(good.ok).toBe(true);
    const bad = compileWith(
      `${QUOTA_SECTION}\n\n## Funnel Overview\n\nWrong slug.\n`,
    );
    expect(bad.ok).toBe(false);
  });

  it("required-if-material shares the code but names waiving as the expected path; suggested is never checked (R11)", () => {
    const result = compileWith(`${PIPELINE_SECTION}\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // quota-attainment (required) missing; coaching-notes (suggested) silent.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].location).toBe("section:quota-attainment");
    // The required-if-material diagnostic names waiving as expected:
    const rim = compileWith(`${QUOTA_SECTION}\n`);
    if (rim.ok) return;
    expect(rim.diagnostics[0].message).toContain(
      "waiving is the expected path",
    );
    expect(rim.diagnostics[0].code).toBe("REQUIRED_SECTION_MISSING");
  });

  it("waiver validation: unknown section, missing reason, suggested tier, no manifest", () => {
    const unknown = compileWith(
      `${QUOTA_SECTION}\n\n\`\`\`tw:waiver\nsection: churn\nreason: x\n\`\`\`\n`,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.diagnostics[0].message).toContain("pipeline-health");
    }
    const noReason = compileWith(
      `${QUOTA_SECTION}\n\n\`\`\`tw:waiver\nsection: pipeline-health\n\`\`\`\n`,
    );
    expect(noReason.ok).toBe(false);
    const suggested = compileWith(
      `${QUOTA_SECTION}\n\n${PIPELINE_SECTION}\n\n\`\`\`tw:waiver\nsection: coaching-notes\nreason: nothing to coach\n\`\`\`\n`,
    );
    expect(suggested.ok).toBe(false);
    if (!suggested.ok) {
      expect(suggested.diagnostics[0].message).toContain("suggested");
    }
    const noManifest = compileDocument({
      plate: REPORT_PLATE,
      title: "t",
      abstract: "a",
      markdownBody: `## Summary\n\n\`\`\`tw:waiver\nsection: x\nreason: y\n\`\`\`\n`,
    });
    expect(noManifest.ok).toBe(false);
    if (!noManifest.ok) {
      expect(noManifest.diagnostics[0].message).toContain(
        "no section manifest",
      );
    }
  });

  it("waiving a section that is also authored rejects with SECTION_WAIVER_CONFLICT", () => {
    const result = compileWith(
      `${QUOTA_SECTION}\n\n${PIPELINE_SECTION}\n\n${WAIVER_BLOCK}\n`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe("SECTION_WAIVER_CONFLICT");
  });

  it("multiple missing required sections produce one diagnostic each (single-pass repair)", () => {
    const result = compileWith(`## Summary\n\nNothing else.\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.location).sort()).toEqual([
      "section:pipeline-health",
      "section:quota-attainment",
    ]);
  });

  it("duplicate headings elsewhere don't false-positive the check (slugger -1 suffixes)", () => {
    // Two "Notes" headings dedupe to notes / notes-1; the manifest sections
    // are present exactly once each and still satisfy.
    const result = compileWith(
      `## Notes\n\nx\n\n## Notes\n\ny\n\n${QUOTA_SECTION}\n\n${PIPELINE_SECTION}\n`,
    );
    expect(result.ok).toBe(true);
  });

  it("a contract-less plate reports no waivers and compiles as before (AE4)", () => {
    const result = compileDocument({
      plate: REPORT_PLATE,
      title: "t",
      abstract: "a",
      markdownBody: REPORT_MARKDOWN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.waivers).toEqual([]);
    expect(result.renderHtml).not.toContain("Section waived");
  });
});

describe("sectionFacts — structural conformance facts (THINK-189 U1)", () => {
  const FACTS_PLATE: CompositorPlate = {
    ...REPORT_PLATE,
    sections: [
      {
        id: "pipeline-health",
        title: "Pipeline Health",
        tier: "suggested",
        guidance: "Stage-by-stage funnel with conversion rates.",
        suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
      },
      {
        id: "quota-attainment",
        title: "Quota Attainment",
        tier: "required",
        guidance: "Attainment vs target for the period.",
      },
      {
        id: "coaching-notes",
        title: "Coaching Notes",
        tier: "required-if-material",
        guidance: "Specific behaviors to keep or change.",
      },
    ],
    analyses: [
      {
        key: "funnel-conversion",
        op: "funnel_conversion",
        presentation: { directive: "chart", chartType: "funnel" },
      },
    ],
  };
  const stubEngine: DirectiveEngine = () => ({
    ok: true,
    html: '<div class="stats"></div>',
    containsSvg: false,
  });

  function factsOf(markdownBody: string, plate = FACTS_PLATE) {
    const result = compileDocument(
      { plate, title: "Rep Review", abstract: "x", markdownBody },
      stubEngine,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("compile failed");
    expect(result.sectionFacts).toBeDefined();
    return result.sectionFacts!;
  }

  const BASE_DOC = `## Quota Attainment

Attainment held at 82% of target.

## Coaching Notes

Keep the discovery-call cadence.
`;

  it("marks a present section with a skipped suggested directive and an uncomputed analysis (AE1)", () => {
    const facts = factsOf(`${BASE_DOC}
## Pipeline Health

Funnel narrative without the chart.
`);
    const pipeline = facts.sections.find((s) => s.id === "pipeline-health")!;
    expect(pipeline.status).toBe("present");
    expect(pipeline.bodyChars).toBeGreaterThan(0);
    expect(pipeline.suggestedDirectives).toEqual([
      { kind: "chart", chartType: "funnel", used: false },
    ]);
    expect(facts.analyses).toEqual([
      { key: "funnel-conversion", computed: false, sectionId: null },
    ]);
  });

  it("marks a suggested directive used and an analysis computed when rendered in-section", () => {
    const facts = factsOf(`${BASE_DOC}
## Pipeline Health

\`\`\`tw:chart
stages: []
\`\`\`

\`\`\`tw:analysis
analysis: funnel-conversion
stages:
  - { label: Leads, count: 120 }
  - { label: Won, count: 12 }
\`\`\`
`);
    const pipeline = facts.sections.find((s) => s.id === "pipeline-health")!;
    expect(pipeline.suggestedDirectives[0].used).toBe(true);
    expect(facts.analyses).toEqual([
      {
        key: "funnel-conversion",
        computed: true,
        sectionId: "pipeline-health",
      },
    ]);
  });

  it("marks a waived section waived with zero body chars", () => {
    const facts = factsOf(`## Quota Attainment

Attainment held at 82% of target.

\`\`\`tw:waiver
section: coaching-notes
reason: No coaching sessions were held this period.
\`\`\`
`);
    const coaching = facts.sections.find((s) => s.id === "coaching-notes")!;
    expect(coaching.status).toBe("waived");
    expect(coaching.tier).toBe("required-if-material");
    expect(coaching.bodyChars).toBe(0);
    const pipeline = facts.sections.find((s) => s.id === "pipeline-health")!;
    expect(pipeline.status).toBe("missing");
  });

  it("keeps facts manifest-shaped: extra headings never appear, manifest sections still count", () => {
    const facts = factsOf(`${BASE_DOC}
## Appendix

Extra content outside the manifest.
`);
    expect(facts.sections.map((s) => s.id).sort()).toEqual([
      "coaching-notes",
      "pipeline-health",
      "quota-attainment",
    ]);
    const quota = facts.sections.find((s) => s.id === "quota-attainment")!;
    expect(quota.status).toBe("present");
    expect(quota.bodyChars).toBeGreaterThan(0);
  });

  it("contract-less plates carry no sectionFacts (AE5)", () => {
    const result = compileDocument({
      plate: REPORT_PLATE,
      title: "Q3 — Report",
      abstract: "x",
      markdownBody: REPORT_MARKDOWN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("sectionFacts" in result).toBe(false);
  });

  it("attributes body to the exact-id match only under duplicate heading slugs", () => {
    const facts = factsOf(`${BASE_DOC}
## Pipeline Health

First occurrence body.

## Pipeline Health

Second occurrence gets the -1 suffix and is not a manifest section.
`);
    const pipeline = facts.sections.find((s) => s.id === "pipeline-health")!;
    expect(pipeline.status).toBe("present");
    // Only the exact-id section's body counts; the "-1" duplicate closed it.
    expect(pipeline.bodyChars).toBe("First occurrence body.".length);
  });

  it("attributes nested subheading content to the enclosing manifest section", () => {
    const facts = factsOf(`${BASE_DOC}
## Pipeline Health

Top-level narrative.

### Stage Detail

Deeper dive under the same manifest section.

## Appendix

Sibling heading closes the section.
`);
    const pipeline = facts.sections.find((s) => s.id === "pipeline-health")!;
    const ownProse =
      "Top-level narrative.".length +
      "Deeper dive under the same manifest section.".length;
    // The h3 (and its heading line) attribute to the enclosing section...
    expect(pipeline.bodyChars).toBeGreaterThanOrEqual(ownProse);
    // ...but the sibling "## Appendix" closed it: appendix prose not counted.
    expect(pipeline.bodyChars).toBeLessThan(
      ownProse + "Sibling heading closes the section.".length,
    );
  });
});

describe("internal-link policy (THINK-272 U3)", () => {
  // The helper is the SOLE gate on policy-surviving anchors (P5): the
  // rejection set below is the AE2 security contract, not style coverage.
  describe("resolveInternalWikiHref — rejections (AE2)", () => {
    const REJECTED = [
      "/wiki/../admin",
      "/wiki/./../x",
      "//host/wiki/entity/x",
      "https://evil.example/wiki/entity/x",
      "http://evil.example/wiki/entity/x",
      "/wiki/..\\admin",
      "\\\\evil.example\\wiki\\entity\\x",
      "/wiki/entity/a\\..\\..\\admin",
      "/wiki/bogus-type/x",
      "/wiki/entity/a/b",
      "/wiki/entity/x/",
      "/wiki/entity/",
      "/wiki/entity",
      "/other/path",
      "javascript:alert(1)",
      "mailto:x@example.com",
      "data:text/html,x",
      "http://[",
      "",
    ];
    for (const href of REJECTED) {
      it(`rejects ${JSON.stringify(href)}`, () => {
        expect(resolveInternalWikiHref(href)).toBeNull();
      });
    }
  });

  describe("resolveInternalWikiHref — acceptance and normalization", () => {
    it("passes well-formed paths through unchanged", () => {
      expect(resolveInternalWikiHref("/wiki/entity/acme-corp")).toBe(
        "/wiki/entity/acme-corp",
      );
      expect(resolveInternalWikiHref("/wiki/topic/best-tacos")).toBe(
        "/wiki/topic/best-tacos",
      );
      expect(resolveInternalWikiHref("/wiki/decision/switched-to-haiku")).toBe(
        "/wiki/decision/switched-to-haiku",
      );
    });

    it("rewrites odd-but-valid input to the normalized path (R4)", () => {
      expect(resolveInternalWikiHref("/wiki/entity/./x")).toBe(
        "/wiki/entity/x",
      );
      expect(resolveInternalWikiHref("/wiki/ignored/../entity/x")).toBe(
        "/wiki/entity/x",
      );
      // Document-relative input resolves against the base ROOT; safe because
      // the emitted href is this normalized absolute path, never the raw one.
      expect(resolveInternalWikiHref("wiki/entity/x")).toBe("/wiki/entity/x");
    });

    it("strips query and fragment; the href is the bare path", () => {
      expect(resolveInternalWikiHref("/wiki/entity/x?q=1#f")).toBe(
        "/wiki/entity/x",
      );
    });

    it("pins encoded-character behavior: %20 survives, encoded separators are NOT route escapes", () => {
      // URL.pathname does not decode percent-escapes during resolution, so
      // %2F / %5C stay opaque slug bytes — [^/]+ is the contract.
      expect(resolveInternalWikiHref("/wiki/topic/a%20b")).toBe(
        "/wiki/topic/a%20b",
      );
      expect(resolveInternalWikiHref("/wiki/entity/a%2Fb")).toBe(
        "/wiki/entity/a%2Fb",
      );
      expect(resolveInternalWikiHref("/wiki/entity/a%5Cb")).toBe(
        "/wiki/entity/a%5Cb",
      );
    });
  });

  const WIKI_LINK_DOC = `## Overview

[Acme](/wiki/entity/acme-corp) and [x](https://evil.example) and [y](/other/path).
`;

  it("AE1: policy-on, only the validated wiki link survives as an anchor", () => {
    const { renderHtml } = compileOk(WIKI_LINK_DOC, {
      internalLinkPolicy: "wiki",
    });
    // Full pipeline (parse → sanitize → envelope): the anchor survives the
    // sanitizer with exactly the normalized path and no other attributes.
    expect(renderHtml).toContain('<a href="/wiki/entity/acme-corp">Acme</a>');
    expect(renderHtml).not.toContain('href="https://evil.example"');
    expect(renderHtml).toContain("x (<code>https://evil.example</code>)");
    expect(renderHtml).not.toContain('href="/other/path"');
    expect(renderHtml).toContain("y (<code>/other/path</code>)");
    expect(renderHtml).not.toContain("target=");
    expect(renderHtml).not.toContain('rel="');
  });

  it("AE2: every rejection vector degrades to inert text in a policy-on compile", () => {
    const vectors = [
      "/wiki/../admin",
      "//host/wiki/entity/x",
      "https://evil.example/wiki/entity/x",
      "/wiki/bogus-type/x",
      "/wiki/entity/a/b",
      "javascript:alert(1)",
    ];
    const doc = `## Overview\n\n${vectors
      .map((v, i) => `[v${i}](${v})`)
      .join(" and ")}\n`;
    const { renderHtml } = compileOk(doc, { internalLinkPolicy: "wiki" });
    expect(renderHtml).not.toContain('<a href="/wiki');
    expect(renderHtml).not.toContain('href="//host');
    expect(renderHtml).not.toContain('evil.example/wiki"');
    expect(renderHtml).not.toContain('javascript:alert(1)"');
    for (let i = 0; i < vectors.length; i++) {
      expect(renderHtml).toContain(`v${i} (<code>`);
    }
  });

  it("normalization rewrites the emitted href, not the raw input", () => {
    const { renderHtml } = compileOk(
      `## Overview\n\n[odd](/wiki/entity/./x)\n`,
      { internalLinkPolicy: "wiki" },
    );
    expect(renderHtml).toContain('<a href="/wiki/entity/x">odd</a>');
    expect(renderHtml).not.toContain("/wiki/entity/./x");
  });

  it("isInertHref precedence: #fragment and mailto: behave exactly as before with the policy on", () => {
    const { renderHtml } = compileOk(
      `## Overview\n\n[frag](#overview) and [mail](mailto:a@b.co)\n`,
      { internalLinkPolicy: "wiki" },
    );
    expect(renderHtml).toContain('<a href="#overview">frag</a>');
    expect(renderHtml).toContain('<a href="mailto:a@b.co">mail</a>');
  });

  it("opt-in means opt-in: policy-off degrades /wiki/ links like any other (R5)", () => {
    const { renderHtml } = compileOk(WIKI_LINK_DOC);
    expect(renderHtml).not.toContain('href="/wiki/entity/acme-corp"');
    expect(renderHtml).toContain("Acme (<code>/wiki/entity/acme-corp</code>)");
  });

  it("determinism: two policy-on compiles produce identical bytes (R5)", () => {
    const a = compileOk(WIKI_LINK_DOC, { internalLinkPolicy: "wiki" });
    const b = compileOk(WIKI_LINK_DOC, { internalLinkPolicy: "wiki" });
    expect(a.renderHtml).toBe(b.renderHtml);
  });
});

describe("tw:sources provenance (plates provenance 2026-07)", () => {
  const MANIFEST_PLATE: CompositorPlate = {
    slug: "rep-check",
    eyebrow: "REP CHECK",
    tokensLight: {},
    tokensDark: {},
    allowedDirectives: ["stats"],
    sections: [
      {
        id: "summary",
        title: "Summary",
        tier: "required",
        guidance: "Headline outcome.",
      },
      {
        id: "pipeline-health",
        title: "Pipeline Health",
        tier: "required-if-material",
        guidance: "Pull data from Twenty CRM.",
      },
      {
        id: "extras",
        title: "Extras",
        tier: "suggested",
        guidance: "Anything else.",
      },
    ],
  };
  const CUSTOMIZED_PLATE: CompositorPlate = {
    ...MANIFEST_PLATE,
    customized: true,
    origin: "platform",
  };

  const SOURCED_DOC = `## Summary

Attainment held at 82%.

\`\`\`tw:sources
section: summary
- tool: twenty--crm.search_records — attainment records (12 rows)
\`\`\`

## Pipeline Health

Funnel narrative.

\`\`\`tw:sources
section: pipeline-health
- none: narrative synthesis of the summary above
\`\`\`
`;

  it("renders the sources card in place and ships the sources CSS only when a fence exists", () => {
    const withSources = compileOk(SOURCED_DOC, { plate: MANIFEST_PLATE });
    expect(withSources.renderHtml).toContain('class="card section-sources"');
    expect(withSources.renderHtml).toContain(".card.section-sources{");
    expect(withSources.renderHtml).toContain(
      "<code>twenty--crm.search_records</code>",
    );

    const withoutSources = compileOk(
      "## Summary\n\nText.\n\n## Pipeline Health\n\nText.\n",
      { plate: MANIFEST_PLATE },
    );
    expect(withoutSources.renderHtml).not.toContain(".card.section-sources{");
  });

  it("tw:sources is structural: it compiles even when allowedDirectives excludes it", () => {
    // MANIFEST_PLATE allows only tw:stats; the fence must still route.
    const result = compileOk(SOURCED_DOC, { plate: MANIFEST_PLATE });
    expect(result.renderHtml).toContain("section-sources");
  });

  it("section facts carry the claimed sources (conformance propagation)", () => {
    const result = compileOk(SOURCED_DOC, { plate: MANIFEST_PLATE });
    const summary = result.sectionFacts!.sections.find(
      (s) => s.id === "summary",
    )!;
    expect(summary.sources).toEqual([
      {
        kind: "tool",
        tool: "twenty--crm.search_records",
        detail: "attainment records (12 rows)",
      },
    ]);
    const pipeline = result.sectionFacts!.sections.find(
      (s) => s.id === "pipeline-health",
    )!;
    expect(pipeline.sources).toEqual([
      { kind: "none", detail: "narrative synthesis of the summary above" },
    ]);
    const extras = result.sectionFacts!.sections.find(
      (s) => s.id === "extras",
    )!;
    expect(extras.sources).toBeUndefined();
  });

  it("uncustomized plates never require sources (golden-parity posture)", () => {
    const result = compileDocument({
      plate: MANIFEST_PLATE,
      title: "T",
      abstract: "",
      markdownBody: "## Summary\n\nText.\n\n## Pipeline Health\n\nText.\n",
    });
    expect(result.ok).toBe(true);
  });

  it("customized plates reject present required sections without a tw:sources fence (SECTION_MISSING_SOURCES)", () => {
    const result = compileDocument({
      plate: CUSTOMIZED_PLATE,
      title: "T",
      abstract: "",
      markdownBody: "## Summary\n\nText.\n\n## Pipeline Health\n\nText.\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes).toEqual([
        "SECTION_MISSING_SOURCES",
        "SECTION_MISSING_SOURCES",
      ]);
      expect(result.diagnostics[0].location).toBe("section:summary");
      expect(result.diagnostics[0].message).toContain('"Summary"');
      expect(result.diagnostics[0].message).toContain("```tw:sources");
      expect(result.diagnostics[0].message).toContain("section: summary");
    }
  });

  it("tenant-origin plates enforce sources too", () => {
    const result = compileDocument({
      plate: { ...MANIFEST_PLATE, origin: "tenant" },
      title: "T",
      abstract: "",
      markdownBody: "## Summary\n\nText.\n\n## Pipeline Health\n\nText.\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.every((d) => d.code === "SECTION_MISSING_SOURCES"),
      ).toBe(true);
    }
  });

  it("customized enforcement: waived sections need no sources, suggested-tier never checked, sourced doc passes", () => {
    const waived = compileDocument({
      plate: CUSTOMIZED_PLATE,
      title: "T",
      abstract: "",
      markdownBody: `## Summary

Text.

\`\`\`tw:sources
section: summary
- tool: some_tool — a query (3 rows)
\`\`\`

\`\`\`tw:waiver
section: pipeline-health
reason: No pipeline data connected.
\`\`\`

## Extras

Suggested-tier body without sources.
`,
    });
    expect(waived.ok).toBe(true);

    const sourced = compileDocument({
      plate: CUSTOMIZED_PLATE,
      title: "T",
      abstract: "",
      markdownBody: SOURCED_DOC,
    });
    expect(sourced.ok).toBe(true);
  });

  it("an invalid tw:sources fence rejects with DIRECTIVE_INVALID", () => {
    const result = compileDocument({
      plate: MANIFEST_PLATE,
      title: "T",
      abstract: "",
      markdownBody:
        "## Summary\n\nText.\n\n```tw:sources\nsection: not-in-manifest\n- tool: x — y\n```\n\n## Pipeline Health\n\nText.\n",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("DIRECTIVE_INVALID");
      expect(result.diagnostics[0].location).toBe("tw:sources");
    }
  });

  it("determinism: sourced compiles are byte-identical", () => {
    const a = compileOk(SOURCED_DOC, { plate: MANIFEST_PLATE }).renderHtml;
    const b = compileOk(SOURCED_DOC, { plate: MANIFEST_PLATE }).renderHtml;
    expect(a).toBe(b);
  });
});
