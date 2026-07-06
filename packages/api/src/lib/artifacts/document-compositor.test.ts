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
