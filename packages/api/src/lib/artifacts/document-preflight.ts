/**
 * HTML Document Artifacts (THINK-147, KTD5): DocSpector — the emission-time
 * preflight validator for document-kind artifacts.
 *
 * A document render must be a fully self-contained single HTML file: the
 * scriptless reader iframe and its injected CSP fail *closed*, so a document
 * that slips an external reference through doesn't leak data — it silently
 * renders broken (missing fonts/images), which reads as "the product is
 * broken". DocSpector converts that silent degradation into an in-turn,
 * model-actionable reject.
 *
 * External-reference detection is DEFAULT-DENY: any attribute or CSS value
 * that resolves to a URL is rejected unless it is a `data:` URI, a
 * same-document `#fragment`, or `mailto:`. Relative URLs are rejected too —
 * from a srcDoc frame they resolve against the app origin. This is a
 * validator, not a sanitizer: it rejects with diagnostics, it never rewrites.
 *
 * Pure function — no DOM, no network, no DB. Called by the emission handler
 * (document-emission.ts) and self-runnable from tests/fixtures.
 */

/** Byte ceilings (KTD5). The card ceiling is enforced at event-append time. */
export const DOCUMENT_RENDER_MAX_BYTES = 256 * 1024;
export const DOCUMENT_DIGEST_MAX_BYTES = 96 * 1024;
export const DOCUMENT_CARD_MAX_BYTES = 10 * 1024;

export type DocumentPreflightCode =
  | "SIZE_CEILING"
  | "SCRIPT_FORBIDDEN"
  | "EXTERNAL_REF"
  | "SKELETON"
  | "DARK_MODE";

export interface DocumentPreflightDiagnostic {
  code: DocumentPreflightCode;
  /** Model-actionable: names the offending value and the fix. */
  message: string;
  /** `line N` (1-based) of the offending match, or a section name. */
  location: string;
}

export type DocumentPreflightResult =
  { ok: true } | { ok: false; diagnostics: DocumentPreflightDiagnostic[] };

/** URL-bearing attributes that are rejected unless the value is inert. */
const URL_ATTRIBUTES = [
  "src",
  "href",
  "srcset",
  "imagesrcset",
  "poster",
  "ping",
  "action",
  "formaction",
  "background",
  "cite",
  "manifest",
  "longdesc",
] as const;

const URL_ATTRIBUTE_RE = new RegExp(
  // (?<![-\w:]) — don't match data-src=, aria-href=, etc.; xlink:href handled
  // explicitly below.
  String.raw`(?<![-\w:])(${URL_ATTRIBUTES.join("|")})\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`,
  "gi",
);

const XLINK_HREF_RE = new RegExp(
  String.raw`(xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`,
  "gi",
);

const OBJECT_DATA_RE = new RegExp(
  String.raw`<object\b[^>]*?(?<![-\w])(data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`,
  "gi",
);

/** Values that are inert (no fetch, no navigation off the document). */
function isInertUrlValue(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (value === "") return true;
  return (
    value.startsWith("data:") ||
    value.startsWith("#") ||
    value.startsWith("mailto:")
  );
}

/** srcset lists multiple candidates — every candidate must be inert. */
function isInertSrcset(raw: string): boolean {
  return raw
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .every((url) => isInertUrlValue(url));
}

function lineOf(source: string, index: number): string {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return `line ${line}`;
}

function snippet(value: string, max = 80): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** Extract a balanced `{...}` block starting at the first `{` after `from`. */
function balancedBlock(source: string, from: number): string | null {
  const open = source.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

export function runDocumentPreflight(input: {
  renderHtml: string;
  digestMarkdown: string;
}): DocumentPreflightResult {
  const { renderHtml, digestMarkdown } = input;
  const diagnostics: DocumentPreflightDiagnostic[] = [];

  // ---- Size ceilings ----------------------------------------------------
  const renderBytes = Buffer.byteLength(renderHtml, "utf8");
  if (renderBytes > DOCUMENT_RENDER_MAX_BYTES) {
    diagnostics.push({
      code: "SIZE_CEILING",
      message: `HTML render is ${renderBytes} bytes; the ceiling is ${DOCUMENT_RENDER_MAX_BYTES}. Tighten the document (drop repeated inline assets, shorten sections) rather than splitting it.`,
      location: "renderHtml",
    });
  }
  const digestBytes = Buffer.byteLength(digestMarkdown, "utf8");
  if (digestBytes > DOCUMENT_DIGEST_MAX_BYTES) {
    diagnostics.push({
      code: "SIZE_CEILING",
      message: `Markdown digest is ${digestBytes} bytes; the ceiling is ${DOCUMENT_DIGEST_MAX_BYTES}. The digest is a faithful summary of the document's substance, not a transcript — condense it.`,
      location: "digestMarkdown",
    });
  }

  // ---- Scripts (document tier is scriptless) ------------------------------
  const scriptTag = /<script\b/i.exec(renderHtml);
  if (scriptTag) {
    diagnostics.push({
      code: "SCRIPT_FORBIDDEN",
      message:
        "<script> is not allowed in documents (any type, including application/json). Use CSS-only interactivity: <details>, anchors, :target.",
      location: lineOf(renderHtml, scriptTag.index),
    });
  }
  for (const match of renderHtml.matchAll(/\son[a-z]+\s*=/gi)) {
    diagnostics.push({
      code: "SCRIPT_FORBIDDEN",
      message: `Inline event handler ${snippet(match[0].trim())} is not allowed — documents are scriptless. Remove it.`,
      location: lineOf(renderHtml, match.index ?? 0),
    });
  }

  // ---- External references (default-deny) --------------------------------
  const flagExternal = (attr: string, value: string, index: number): void => {
    diagnostics.push({
      code: "EXTERNAL_REF",
      message: `${attr}="${snippet(value)}" references outside the document. Documents must be fully self-contained: inline the asset as a data: URI, use a same-document #anchor, or remove it. External fonts/styles must become inline CSS with system font stacks.`,
      location: lineOf(renderHtml, index),
    });
  };

  for (const match of renderHtml.matchAll(URL_ATTRIBUTE_RE)) {
    const attr = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    const inert =
      attr === "srcset" || attr === "imagesrcset"
        ? isInertSrcset(value)
        : isInertUrlValue(value);
    if (!inert) flagExternal(attr, value, match.index ?? 0);
  }
  for (const match of renderHtml.matchAll(XLINK_HREF_RE)) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (!isInertUrlValue(value)) {
      flagExternal("xlink:href", value, match.index ?? 0);
    }
  }
  for (const match of renderHtml.matchAll(OBJECT_DATA_RE)) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (!isInertUrlValue(value)) {
      flagExternal("object data", value, match.index ?? 0);
    }
  }

  const baseTag = /<base\b/i.exec(renderHtml);
  if (baseTag) {
    diagnostics.push({
      code: "EXTERNAL_REF",
      message:
        "<base> is not allowed — it re-points every relative reference in the document. Remove it.",
      location: lineOf(renderHtml, baseTag.index),
    });
  }
  const metaRefresh = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.exec(
    renderHtml,
  );
  if (metaRefresh) {
    diagnostics.push({
      code: "EXTERNAL_REF",
      message:
        '<meta http-equiv="refresh"> is not allowed — documents never navigate. Remove it.',
      location: lineOf(renderHtml, metaRefresh.index),
    });
  }
  for (const match of renderHtml.matchAll(/@import\b/gi)) {
    diagnostics.push({
      code: "EXTERNAL_REF",
      message:
        "@import is not allowed — all CSS must be inline in the document's <style>. Inline the imported rules.",
      location: lineOf(renderHtml, match.index ?? 0),
    });
  }
  for (const match of renderHtml.matchAll(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
  )) {
    const target = match[2] ?? "";
    if (!isInertUrlValue(target)) {
      diagnostics.push({
        code: "EXTERNAL_REF",
        message: `CSS url(${snippet(target)}) references outside the document. Inline as a data: URI (or a same-document #reference for SVG paint servers) or remove it.`,
        location: lineOf(renderHtml, match.index ?? 0),
      });
    }
  }
  for (const match of renderHtml.matchAll(/(javascript|vbscript):/gi)) {
    diagnostics.push({
      code: "SCRIPT_FORBIDDEN",
      message: `${match[1]}: URL is not allowed anywhere in a document. Remove it.`,
      location: lineOf(renderHtml, match.index ?? 0),
    });
  }

  // ---- Skeleton -----------------------------------------------------------
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(renderHtml);
  if (!titleMatch || titleMatch[1].trim() === "") {
    diagnostics.push({
      code: "SKELETON",
      message:
        "Document needs a non-empty <title>. Add one matching the document's H1.",
      location: "head",
    });
  }
  if (!/<h[1-6]\b[^>]*\bid\s*=/i.test(renderHtml)) {
    diagnostics.push({
      code: "SKELETON",
      message:
        'Document needs at least one id-anchored heading (e.g. <h2 id="summary">) so sections are linkable and machine-navigable.',
      location: "body",
    });
  }

  // ---- Dark mode (presence proxy — correctness is owned by plates + pixel
  // review, per KTD5) -------------------------------------------------------
  const darkMedia = /@media[^{]*prefers-color-scheme\s*:\s*dark/i.exec(
    renderHtml,
  );
  const darkBlock = darkMedia
    ? balancedBlock(renderHtml, darkMedia.index)
    : null;
  const hasColorDeclaration =
    darkBlock !== null &&
    /(?:^|[^-\w])(?:--[\w-]+|color|background[\w-]*|border[\w-]*|fill|stroke)\s*:/i.test(
      darkBlock,
    );
  if (!hasColorDeclaration) {
    diagnostics.push({
      code: "DARK_MODE",
      message:
        "Document needs a non-empty `@media (prefers-color-scheme: dark)` block that redefines at least one color (custom properties preferred). Both themes are required.",
      location: darkMedia ? lineOf(renderHtml, darkMedia.index) : "styles",
    });
  }

  return diagnostics.length === 0 ? { ok: true } : { ok: false, diagnostics };
}
