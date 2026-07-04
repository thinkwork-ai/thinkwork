import { describe, expect, it } from "vitest";
import {
  DOCUMENT_DIGEST_MAX_BYTES,
  DOCUMENT_RENDER_MAX_BYTES,
  runDocumentPreflight,
  type DocumentPreflightDiagnostic,
} from "./document-preflight.js";

/** Minimal document that passes every check — the base for mutations. */
const VALID_DOC = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Quarterly Report</title>
<style>
:root { --bg: #ffffff; --ink: #111111; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #16181c; --ink: #e6e3dd; }
}
body { background: var(--bg); color: var(--ink); font-family: -apple-system, sans-serif; }
@media print { body { background: #fff; } }
</style>
</head>
<body>
<h1 id="top">Quarterly Report</h1>
<h2 id="summary">Summary</h2>
<p>All good. See <a href="#summary">summary</a>.</p>
<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>
<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="chart">
</body>
</html>`;

const DIGEST = "# Quarterly Report\n\nAll good.";

function run(renderHtml: string, digestMarkdown = DIGEST) {
  return runDocumentPreflight({ renderHtml, digestMarkdown });
}

function codes(result: ReturnType<typeof run>): string[] {
  return result.ok
    ? []
    : result.diagnostics.map((d: DocumentPreflightDiagnostic) => d.code);
}

describe("runDocumentPreflight", () => {
  it("passes a fully self-contained dual-theme document", () => {
    expect(run(VALID_DOC)).toEqual({ ok: true });
  });

  // ---- AE1: external font link ------------------------------------------
  it("rejects a Google Fonts link and names the URL (AE1)", () => {
    const doc = VALID_DOC.replace(
      "<style>",
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">\n<style>',
    );
    const result = run(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const ext = result.diagnostics.find((d) => d.code === "EXTERNAL_REF");
    expect(ext?.message).toContain("fonts.googleapis.com");
    expect(ext?.location).toMatch(/^line \d+$/);
  });

  // ---- AE5: script tag ----------------------------------------------------
  it("rejects <script> of any type (AE5)", () => {
    const inline = VALID_DOC.replace(
      "</body>",
      "<script>alert(1)</script></body>",
    );
    expect(codes(run(inline))).toContain("SCRIPT_FORBIDDEN");
    const jsonIsland = VALID_DOC.replace(
      "</body>",
      '<script type="application/json">{"a":1}</script></body>',
    );
    expect(codes(run(jsonIsland))).toContain("SCRIPT_FORBIDDEN");
  });

  it("rejects inline event handlers and javascript: URLs", () => {
    const handler = VALID_DOC.replace("<body>", '<body onload="x()">');
    expect(codes(run(handler))).toContain("SCRIPT_FORBIDDEN");
    const jsUrl = VALID_DOC.replace(
      'href="#summary"',
      'href="javascript:void(0)"',
    );
    expect(codes(run(jsUrl))).toContain("SCRIPT_FORBIDDEN");
  });

  // ---- Default-deny external references -----------------------------------
  it("rejects relative URLs (they resolve against the app origin)", () => {
    const doc = VALID_DOC.replace(
      'src="data:image/svg+xml;base64,PHN2Zy8+"',
      'src="/assets/logo.png"',
    );
    expect(codes(run(doc))).toContain("EXTERNAL_REF");
    const relative = VALID_DOC.replace(
      'href="#summary"',
      'href="other-page.html"',
    );
    expect(codes(run(relative))).toContain("EXTERNAL_REF");
  });

  it("rejects srcset, object data, embed src, poster, ping, and SVG xlink:href sinks", () => {
    const cases = [
      VALID_DOC.replace(
        "<img src=",
        '<img srcset="https://cdn.example.com/x.png 1x" src=',
      ),
      VALID_DOC.replace(
        "</body>",
        '<object data="https://evil.example/x.swf"></object></body>',
      ),
      VALID_DOC.replace(
        "</body>",
        '<embed src="https://evil.example/x"></body>',
      ),
      VALID_DOC.replace(
        "</body>",
        '<video poster="https://evil.example/p.jpg"></video></body>',
      ),
      VALID_DOC.replace(
        'href="#summary"',
        'href="#summary" ping="https://evil.example/track"',
      ),
      VALID_DOC.replace(
        '<rect fill="url(#g)"/>',
        '<use xlink:href="https://evil.example/sprite.svg#icon"/>',
      ),
    ];
    for (const doc of cases) {
      expect(codes(run(doc))).toContain("EXTERNAL_REF");
    }
  });

  it("rejects <base>, <meta refresh>, @import, and external CSS url()", () => {
    expect(
      codes(
        run(
          VALID_DOC.replace(
            "<style>",
            '<base href="https://x.example/">\n<style>',
          ),
        ),
      ),
    ).toContain("EXTERNAL_REF");
    expect(
      codes(
        run(
          VALID_DOC.replace(
            "<style>",
            '<meta http-equiv="refresh" content="0;url=https://x.example">\n<style>',
          ),
        ),
      ),
    ).toContain("EXTERNAL_REF");
    expect(
      codes(
        run(VALID_DOC.replace(":root {", '@import url("x.css");\n:root {')),
      ),
    ).toContain("EXTERNAL_REF");
    expect(
      codes(
        run(
          VALID_DOC.replace(
            "background: var(--bg);",
            "background: url(https://evil.example/bg.png);",
          ),
        ),
      ),
    ).toContain("EXTERNAL_REF");
  });

  it("allows data: URIs, mailto:, #anchors, SVG url(#ref), and data-* attributes", () => {
    const doc = VALID_DOC.replace(
      "</body>",
      '<a href="mailto:team@example.com">mail</a><div data-src="not-a-sink" data-theme="dark"></div></body>',
    );
    expect(run(doc)).toEqual({ ok: true });
  });

  // ---- Ceilings -----------------------------------------------------------
  it("rejects an oversize render with actual vs limit", () => {
    const doc = VALID_DOC.replace(
      "</body>",
      `<p>${"x".repeat(DOCUMENT_RENDER_MAX_BYTES)}</p></body>`,
    );
    const result = run(doc);
    expect(codes(result)).toContain("SIZE_CEILING");
    if (result.ok) return;
    const size = result.diagnostics.find((d) => d.code === "SIZE_CEILING");
    expect(size?.message).toContain(String(DOCUMENT_RENDER_MAX_BYTES));
  });

  it("rejects an oversize digest", () => {
    const result = run(VALID_DOC, "y".repeat(DOCUMENT_DIGEST_MAX_BYTES + 1));
    expect(codes(result)).toContain("SIZE_CEILING");
  });

  // ---- Skeleton -----------------------------------------------------------
  it("rejects a missing or empty <title> and missing anchored headings", () => {
    expect(
      codes(run(VALID_DOC.replace("<title>Quarterly Report</title>", ""))),
    ).toContain("SKELETON");
    expect(
      codes(
        run(
          VALID_DOC.replace('<h1 id="top">', "<h1>").replace(
            '<h2 id="summary">',
            "<h2>",
          ),
        ),
      ),
    ).toContain("SKELETON");
  });

  // ---- Dark mode -----------------------------------------------------------
  it("rejects a missing dark-mode block", () => {
    const doc = VALID_DOC.replace(
      /@media \(prefers-color-scheme: dark\) \{[^}]*\}[^}]*\}/,
      "",
    );
    expect(codes(run(doc))).toContain("DARK_MODE");
  });

  it("rejects an empty dark-mode block (presence proxy hardened)", () => {
    const doc = VALID_DOC.replace(
      "@media (prefers-color-scheme: dark) {\n  :root { --bg: #16181c; --ink: #e6e3dd; }\n}",
      "@media (prefers-color-scheme: dark) { /* TODO */ }",
    );
    expect(codes(run(doc))).toContain("DARK_MODE");
  });

  // ---- Diagnostics shape ---------------------------------------------------
  it("returns every violation in one pass, not just the first", () => {
    const doc = VALID_DOC.replace(
      "</body>",
      '<script>x</script><img src="https://a.example/x.png"></body>',
    ).replace("<title>Quarterly Report</title>", "<title></title>");
    const result = run(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const found = new Set(result.diagnostics.map((d) => d.code));
    expect(found).toContain("SCRIPT_FORBIDDEN");
    expect(found).toContain("EXTERNAL_REF");
    expect(found).toContain("SKELETON");
  });
});
