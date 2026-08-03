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

/** File name shown for a cited document (the key's last path segment). */
export function knowledgeDocumentFileName(documentKey: string): string {
  const base = documentKey.slice(documentKey.lastIndexOf("/") + 1);
  return base || documentKey;
}

/**
 * Cited documents open in the thread's docked artifact panel (THINK-168)
 * rather than a new tab. The panel store only holds a string "artifact id",
 * so a cited document rides through it as a `kb-doc:` id carrying the
 * signed link, key, and page. Only the signed doc-link shape is ever
 * encoded — the same gate `openKnowledgeDocument` applies — so a parsed id
 * is safe to hand to the viewer/iframe.
 */
export const KB_DOC_PANEL_ID_PREFIX = "kb-doc:";

export interface KbDocPanelTarget {
  key: string;
  /** Signed /kb/doc link (validated by isSignedDocLink on both ends). */
  src: string;
  page?: number;
}

/** Panel-store id for a cited document, or null when the citation cannot be
 * panel-rendered (no URL, or not the signed doc-link shape). */
export function kbDocPanelId(source: OpenableKnowledgeDocument): string | null {
  const url = source.documentUrl;
  if (!url || !isSignedDocLink(url)) return null;
  const target: KbDocPanelTarget = { key: source.key, src: url };
  if (source.page) target.page = source.page;
  return `${KB_DOC_PANEL_ID_PREFIX}${encodeURIComponent(JSON.stringify(target))}`;
}

export function parseKbDocPanelId(id: string): KbDocPanelTarget | null {
  if (!id.startsWith(KB_DOC_PANEL_ID_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      decodeURIComponent(id.slice(KB_DOC_PANEL_ID_PREFIX.length)),
    );
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { key, src, page } = parsed as Record<string, unknown>;
  if (typeof key !== "string" || !key) return null;
  if (typeof src !== "string" || !isSignedDocLink(src)) return null;
  const target: KbDocPanelTarget = { key, src };
  if (typeof page === "number" && Number.isFinite(page)) target.page = page;
  return target;
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
