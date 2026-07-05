/**
 * Document Compositor v2 (THINK-154): compiler-owned per-genre house templates.
 *
 * The head/CSS below is extracted from the four document-composer genre plates
 * (packages/workspace-defaults/files/skills/document-composer/references/
 * plate-*.html) — all four plates share a byte-identical <style> block, so the
 * compositor owns ONE copy. A parity test (document-compositor.test.ts) keeps
 * this constant in sync with the plate files while both exist; once the skill
 * stops shipping plate HTML the compiler copy is the single source of truth.
 *
 * The `tw-plate` meta marker is retained in compiled output: legacy tooling
 * and the transition-period PLATE gate recognize it, and it identifies the
 * genre a render was compiled for.
 */

import type { DocumentGenre } from "./document-emission.js";

/**
 * Shared plate CSS — byte-identical to the <style> block of every genre plate.
 * Do not edit without updating the plate files (parity-tested).
 */
export const DOCUMENT_PLATE_CSS = `:root{
  --bg:#faf9f7; --ink:#1e2126; --muted:#5c6470; --line:#e3ded6; --card:#ffffff;
  --accent:#0f6b5c; --accent-soft:#e7f2ef; --accent-text:#0b5a4d;
  --warn:#9a5b00; --warn-soft:#fdf3e3; --warn-text:#7c4a00;
  --info:#2b5aa0; --info-soft:#e9f0fa; --info-text:#234b86;
  --bad:#a03030; --bad-soft:#fbeaea; --bad-text:#8a2626;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#16181c; --ink:#e6e3dd; --muted:#9aa2ad; --line:#2c3037; --card:#1d2025;
    --accent:#4cc2ab; --accent-soft:#12332d; --accent-text:#7fd8c6;
    --warn:#e0a44a; --warn-soft:#33270f; --warn-text:#eebd72;
    --info:#7aa7e0; --info-soft:#16243a; --info-text:#9dbfec;
    --bad:#e08585; --bad-soft:#3a1c1c; --bad-text:#eda3a3;
  }
}
:root[data-theme="dark"]{
  --bg:#16181c; --ink:#e6e3dd; --muted:#9aa2ad; --line:#2c3037; --card:#1d2025;
  --accent:#4cc2ab; --accent-soft:#12332d; --accent-text:#7fd8c6;
  --warn:#e0a44a; --warn-soft:#33270f; --warn-text:#eebd72;
  --info:#7aa7e0; --info-soft:#16243a; --info-text:#9dbfec;
  --bad:#e08585; --bad-soft:#3a1c1c; --bad-text:#eda3a3;
}
:root[data-theme="light"]{
  --bg:#faf9f7; --ink:#1e2126; --muted:#5c6470; --line:#e3ded6; --card:#ffffff;
  --accent:#0f6b5c; --accent-soft:#e7f2ef; --accent-text:#0b5a4d;
  --warn:#9a5b00; --warn-soft:#fdf3e3; --warn-text:#7c4a00;
  --info:#2b5aa0; --info-soft:#e9f0fa; --info-text:#234b86;
  --bad:#a03030; --bad-soft:#fbeaea; --bad-text:#8a2626;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
main{max-width:920px;margin:0 auto;padding:32px 24px 64px}
p,li,dd{max-width:72ch}
h1{font-size:1.7em;line-height:1.25;margin:.2em 0 .3em}
h2{font-size:1.25em;margin:2.2em 0 .6em;padding-top:.6em;border-top:1px solid var(--line)}
h3{font-size:1.05em;margin:1.4em 0 .4em}
a{color:var(--info)}
code{font-family:var(--mono);font-size:.88em;background:var(--accent-soft);padding:1px 5px;border-radius:4px}
.eyebrow{font-size:.72em;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.meta{color:var(--muted);font-size:.9em;margin:.2em 0 1.2em}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:110px}
.stat .n{font-size:1.35em;font-weight:700}
.stat .l{font-size:.78em;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:14px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card .q{font-size:.72em;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.card .a{font-weight:700;margin:.25em 0 .35em}
.card p{font-size:.92em;margin:0;color:var(--muted)}
.pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.75em;font-weight:600}
.pill.acc{background:var(--accent-soft);color:var(--accent-text)}
.pill.warn{background:var(--warn-soft);color:var(--warn-text)}
.pill.info{background:var(--info-soft);color:var(--info-text)}
.pill.bad{background:var(--bad-soft);color:var(--bad-text)}
article.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:16px 0}
article.item h3{margin:.1em 0 .5em}
article.item .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
dl.fields{margin:0}
dl.fields dt{font-size:.72em;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:.8em}
dl.fields dd{margin:.15em 0 0}
table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:.92em}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
th{background:var(--accent-soft);color:var(--accent-text);font-size:.85em}
figure{margin:18px 0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
figcaption{font-size:.85em;color:var(--muted);margin-top:8px}
footer.composition-signal{margin-top:48px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:.82em}
svg text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media print{
  body{background:#fff;color:#111}
  main{max-width:none;padding:0}
  article.item,.card,.stat,figure,table{break-inside:avoid}
}`;

export interface GenreTemplate {
  /** Default small-caps category label above the title. */
  eyebrow: string;
  /** Suffix appended to the H1/<title> ("[Subject] — Report"). */
  titleSuffix: string;
}

export const GENRE_TEMPLATES: Record<DocumentGenre, GenreTemplate> = {
  ideation: { eyebrow: "IDEATION", titleSuffix: "Ideation" },
  plan: { eyebrow: "PLAN", titleSuffix: "Plan" },
  report: { eyebrow: "REPORT", titleSuffix: "Report" },
  brief: { eyebrow: "DECISION BRIEF", titleSuffix: "Brief" },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Assemble the full self-contained document shell around a compiled body.
 * All string inputs except `bodyHtml` and `footerHtml` are treated as
 * untrusted text and HTML-escaped; the body/footer are compiler output.
 */
export function renderDocumentShell(input: {
  genre: DocumentGenre;
  title: string;
  eyebrow: string;
  metaLineHtml: string | null;
  bodyHtml: string;
  footerHtml: string;
}): string {
  const t = escapeHtml(input.title);
  const meta = input.metaLineHtml ? `\n${input.metaLineHtml}` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="tw-plate" content="${input.genre}">
<title>${t}</title>
<style>
${DOCUMENT_PLATE_CSS}
</style>
</head>
<body>
<main>

<div class="eyebrow">${escapeHtml(input.eyebrow)}</div>
<h1 id="doc-title">${t}</h1>${meta}

${input.bodyHtml}

${input.footerHtml}
</main>
</body>
</html>
`;
}
