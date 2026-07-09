/**
 * Native port of the web document reader frame envelope
 * (`apps/web/src/components/workbench/DocumentFrame.tsx`): document-kind
 * artifacts carry server-compiled, scriptless plate HTML that mobile shows
 * in a JS-disabled WebView. Before mounting we prepend the same restrictive
 * CSP meta + theme token the web iframe injects, plus a viewport meta —
 * without one WKWebView lays plates out at desktop width and scales down.
 */

export const DOCUMENT_FRAME_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;";

const VIEWPORT_META =
  '<meta name="viewport" content="width=device-width, initial-scale=1">';

/** Matches web's `isDocumentArtifactMetadata`: artifacts whose
 *  `metadata.kind === "document"` are compiled plate documents. Mobile
 *  receives `metadata` as an AWSJSON string, so accept both shapes. */
export function isDocumentArtifactMetadata(metadata: unknown): boolean {
  if (metadata == null) return false;
  let value = metadata;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "document"
  );
}

/**
 * Prepend CSP + theme token + viewport into the compiled document HTML.
 * Mirrors web's `withDocumentFrameEnvelope`; plates key dark styles off
 * `prefers-color-scheme` with `:root[data-theme="dark"]` overrides, so
 * stamping `data-theme` on <html> makes the app theme win scriptlessly.
 */
export function withDocumentFrameEnvelope(
  html: string,
  theme: "light" | "dark",
): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_FRAME_CSP}">`;
  const themeStyle = `<style data-thinkwork-document-theme>:root{color-scheme:${theme};}</style>`;
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const injected = `${cspMeta}${hasViewport ? "" : VIEWPORT_META}${themeStyle}`;

  let out = html;
  const htmlTag = out.match(/<html(\s[^>]*)?>/i);
  if (htmlTag?.index != null) {
    const attrs = htmlTag[1] ?? "";
    const replaced = `<html${attrs} data-theme="${theme}">`;
    out =
      out.slice(0, htmlTag.index) +
      replaced +
      out.slice(htmlTag.index + htmlTag[0].length);
  }

  const headMatch = out.match(/<head(?:\s[^>]*)?>/i);
  if (headMatch?.index == null) return `${injected}${out}`;
  const insertAt = headMatch.index + headMatch[0].length;
  return `${out.slice(0, insertAt)}${injected}${out.slice(insertAt)}`;
}
