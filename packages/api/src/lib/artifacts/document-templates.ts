/**
 * Document Compositor v2 (THINK-154): the compiler-owned house template.
 *
 * The base CSS below is the single source of truth for document styling
 * (THINK-153: the skill's plate-*.html files are retired — plates are now
 * registry configuration, not HTML). Plate-specific palettes arrive as
 * resolved CSS custom-property override maps (plate registry KTD2) and are
 * appended AFTER the base block, so an empty override map compiles
 * byte-identical output to the pre-registry compositor.
 *
 * The `tw-plate` meta marker is retained in compiled output: it identifies
 * the plate slug a render was compiled for (the runtime PLATE gate itself is
 * retired — compiler output is plate-conformant by construction).
 */

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
pre{font-family:var(--mono);background:var(--accent-soft);padding:12px 14px;border-radius:8px;overflow-x:auto}
pre code{background:none;padding:0;border-radius:0}
.eyebrow{font-size:.72em;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.meta{color:var(--muted);font-size:.9em;margin:.2em 0 1.2em}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:110px}
.stat .n{font-size:1.35em;font-weight:700}
.stat .l{font-size:.78em;color:var(--muted)}
.timeline{display:flex;flex-wrap:wrap;margin:18px 0 6px}
.timeline .t-item{flex:1 1 0;min-width:120px;max-width:220px;text-align:center;padding:0 6px;position:relative}
.timeline .t-label{font-size:.92em;font-weight:600;overflow-wrap:break-word}
.timeline .t-track{position:relative;height:22px;margin:6px 0}
.timeline .t-track::before{content:"";position:absolute;left:-6px;right:-6px;top:50%;height:2px;background:var(--line)}
.timeline .t-item:first-child .t-track::before{left:50%}
.timeline .t-item:last-child .t-track::before{right:50%}
.timeline .t-dot{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:999px;background:var(--card);border:2px solid var(--accent)}
.timeline .t-item.current .t-dot{background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.timeline .t-item.current .t-label{font-weight:800}
.timeline .t-caption{font-size:.8em;color:var(--muted)}
.timeline .t-date{font-size:.75em;color:var(--muted)}
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
@page{margin:18mm 16mm}
@media print{
  body{background:#fff;color:#111}
  main{max-width:none;padding:0}
  article.item,.card,.stat,figure,table,blockquote,pre{break-inside:avoid}
  .timeline .t-item{break-inside:avoid}
  h1,h2,h3,h4{break-after:avoid}
  h1,h2,h3,h4,p,li,th,td,figcaption{color:#111}
  a{color:#111;text-decoration:underline}
  th{background:#f3f4f6;color:#111}
  .card,.stat,figure{background:#fff;border-color:#d1d5db}
  img,svg{max-width:100%}
  footer.composition-signal{color:#6b7280}
}`;

/**
 * Build the CSS block that layers a plate's resolved token values over the
 * base palette. Returns "" when both maps are empty (golden parity: an
 * uncustomized core plate compiles byte-identical to the pre-registry
 * output). Token names and values were guarded at save AND re-filtered at
 * resolution (plate-registry.ts) — by construction they contain no braces,
 * angle brackets, or url()/expression() vectors.
 */
export function buildPlateTokenOverrideCss(
  tokensLight: Record<string, string>,
  tokensDark: Record<string, string>,
): string {
  const decls = (tokens: Record<string, string>): string =>
    Object.entries(tokens)
      .map(([name, value]) => `  ${name}:${value};`)
      .join("\n");
  const parts: string[] = [];
  if (Object.keys(tokensLight).length > 0) {
    // Light overrides ride an explicit light media query (not a bare :root):
    // this block is appended AFTER the base CSS, so a bare :root would win
    // over the base's @media-dark block under a dark scheme preference.
    parts.push(
      `@media (prefers-color-scheme: light){\n  :root{\n${decls(tokensLight)}\n  }\n}`,
    );
    parts.push(`:root[data-theme="light"]{\n${decls(tokensLight)}\n}`);
  }
  if (Object.keys(tokensDark).length > 0) {
    parts.push(
      `@media (prefers-color-scheme: dark){\n  :root{\n${decls(tokensDark)}\n  }\n}`,
    );
    parts.push(`:root[data-theme="dark"]{\n${decls(tokensDark)}\n}`);
  }
  return parts.join("\n");
}

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
  plateSlug: string;
  title: string;
  eyebrow: string;
  metaLineHtml: string | null;
  bodyHtml: string;
  footerHtml: string;
  /** Resolved plate token overrides (plate registry); empty = base palette. */
  tokensLight?: Record<string, string>;
  tokensDark?: Record<string, string>;
}): string {
  const t = escapeHtml(input.title);
  const meta = input.metaLineHtml ? `\n${input.metaLineHtml}` : "";
  const overrideCss = buildPlateTokenOverrideCss(
    input.tokensLight ?? {},
    input.tokensDark ?? {},
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="tw-plate" content="${escapeHtml(input.plateSlug)}">
<title>${t}</title>
<style>
${DOCUMENT_PLATE_CSS}${overrideCss ? `\n${overrideCss}` : ""}
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
