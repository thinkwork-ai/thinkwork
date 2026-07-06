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
  type CompositorPlate,
  type DirectiveEngine,
} from "./document-compositor.js";
import { runDocumentPreflight } from "./document-preflight.js";
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
    expect(result.renderHtml).toContain("<details><summary>Chart data</summary>");
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
    expect(result.diagnostics[0].message).toContain("Corrected minimal example");
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
        '```tw:chart\ntype: bar\ntitle: x\nseries:\n  - { label: a, value: 1 }\n```',
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
