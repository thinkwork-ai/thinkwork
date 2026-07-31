/**
 * Routing for cited knowledge documents: which ones open in the in-app
 * document viewer (/documents/view, Zrimo) instead of the raw
 * retrieval-supplied URL.
 *
 * Citation `documentUrl`s from the brain knowledge server are stable
 * HMAC-signed `GET /kb/doc?key&exp&sig` links that presign at click time
 * and 302 to the S3 bytes with `inline` disposition. Browsers render
 * pdf/txt/md natively from that, but have no Office renderer — docx/xlsx
 * used to force-download. Those formats open in the viewer, which fetches
 * the same link as JSON (`Accept: application/json` → `{url}`) and renders
 * the bytes client-side.
 *
 * Only the known signed doc-link shape routes to the viewer: the viewer
 * page fetches whatever `src` it is given, so the gate here is also the
 * gate on what URLs it can be pointed at.
 */
import { openInNewTab } from "./open-in-new-tab";

/** Extensions the in-app viewer renders that the browser cannot. pdf/txt/
 * md/html/json keep the browser's native viewers via the raw link. */
const DOCUMENT_VIEWER_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
]);

export function opensInDocumentViewer(documentKey: string): boolean {
  const extension = documentKey.split(".").pop()?.toLowerCase() ?? "";
  return DOCUMENT_VIEWER_EXTENSIONS.has(extension);
}

/** True for the signed doc-link shape knowledge servers mint: an https
 * `…/kb/doc` URL whose query carries the full key, expiry, and signature.
 * (http is allowed only for loopback dev servers.) */
export function isSignedDocLink(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const loopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback)
  ) {
    return false;
  }
  if (!parsed.pathname.endsWith("/kb/doc")) return false;
  return ["key", "exp", "sig"].every((param) =>
    Boolean(parsed.searchParams.get(param)),
  );
}

/** In-app viewer href for a cited document. */
export function documentViewerHref(args: {
  src: string;
  key: string;
  page?: number;
}): string {
  const params = new URLSearchParams({ src: args.src, key: args.key });
  if (args.page) params.set("page", String(args.page));
  return `/documents/view?${params.toString()}`;
}

export interface OpenableKnowledgeDocument {
  key: string;
  page?: number;
  documentUrl?: string;
}

/**
 * Open a cited document in a new tab: Office formats via the in-app
 * viewer, everything else via the raw retrieval-supplied URL (native
 * browser viewers honour the `#page=` fragment for PDFs).
 *
 * Fully synchronous so callers can invoke it straight from a click
 * handler without popup blockers interfering. Throws when the citation
 * carries no URL — only retrieval-supplied URLs are resolvable.
 */
export function openKnowledgeDocument(source: OpenableKnowledgeDocument): void {
  const url = source.documentUrl;
  if (!url) throw new Error("Source document is not viewable");
  if (opensInDocumentViewer(source.key) && isSignedDocLink(url)) {
    openInNewTab(
      documentViewerHref({ src: url, key: source.key, page: source.page }),
    );
    return;
  }
  openInNewTab(source.page ? `${url}#page=${source.page}` : url);
}
