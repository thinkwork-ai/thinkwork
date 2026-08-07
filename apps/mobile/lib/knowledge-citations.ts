/**
 * Knowledge-base citations for thread answers — the mobile port of the web
 * app's citation pipeline (apps/web/src/components/ai-elements/sources.tsx +
 * inline-citation.tsx + lib/knowledge-doc-viewer.ts). Pure functions only;
 * the UI lives in components/threads/KnowledgeSourcesCard.tsx and the
 * MarkdownMessage citation rule.
 *
 * Citations are derived client-side from `ThreadTurn.usageJson.tool_invocations`
 * — there is no GraphQL citation type. Keep the extraction logic in lockstep
 * with the web implementation: same three invocation shapes, same
 * first-occurrence-wins rules.
 */

/**
 * Split a `<key>#p=<n>` page-document id into its source key and page.
 * Paginated documents can be ingested one document per page, so the runtime's
 * citation lines can carry the page suffix.
 */
export function splitPageDocumentKey(raw: string): {
  key: string;
  page?: number;
} {
  const match = /^(.*)#p=(\d+)$/.exec(raw);
  if (!match) return { key: raw };
  return { key: match[1], page: Number(match[2]) };
}

/** One cited document, with the page the passage came from when reported. */
export interface KnowledgeSource {
  key: string;
  /** 1-based page of the source document, used to deep-link the viewer. */
  page?: number;
  /** Retrieval-supplied view URL (see KnowledgeCitation.documentUrl). */
  documentUrl?: string;
}

/**
 * One numbered passage the answer can cite inline. `n` is the marker the
 * runtime handed the model (`[3]`), stable across every search in the turn.
 */
export interface KnowledgeCitation {
  n: number;
  key: string;
  page?: number;
  /** Excerpt shown in the citation detail sheet. */
  quote?: string;
  /** Retrieval-supplied view URL (MCP knowledge servers own their documents
   * and presign access per hit). The only resolvable open path. */
  documentUrl?: string;
}

/** Iterate the search_knowledge invocations of one turn. */
function forEachKnowledgeInvocation(
  invocations: unknown[],
  visit: (record: Record<string, unknown>) => void,
): void {
  for (const value of invocations) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const name =
      (typeof record.tool_name === "string" && record.tool_name) ||
      (typeof record.toolName === "string" && record.toolName) ||
      (typeof record.name === "string" && record.name) ||
      "";
    if (name !== "search_knowledge") continue;
    visit(record);
  }
}

/**
 * Structured hit rows from an MCP knowledge-server invocation. Recognition is
 * by the server's REAL tool name in `details.mcp_tool_name` — the exposed
 * AgentTool name may be hash-truncated.
 */
function mcpKnowledgeRows(
  record: Record<string, unknown>,
): Record<string, unknown>[] {
  const result = record.result as Record<string, unknown> | undefined;
  const details = result?.details as Record<string, unknown> | undefined;
  const mcpTool =
    typeof details?.mcp_tool_name === "string" ? details.mcp_tool_name : "";
  if (!/knowledge_search|search_knowledge/i.test(mcpTool)) return [];
  const raw = details?.raw as Record<string, unknown> | undefined;
  const structured = raw?.structuredContent as
    | Record<string, unknown>
    | undefined;
  const rows = structured?.results ?? structured?.hits;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object",
  );
}

function forEachMcpKnowledgeInvocation(
  invocations: unknown[],
  visit: (rows: Record<string, unknown>[]) => void,
): void {
  for (const value of invocations) {
    if (!value || typeof value !== "object") continue;
    const rows = mcpKnowledgeRows(value as Record<string, unknown>);
    if (rows.length > 0) visit(rows);
  }
}

/**
 * Numbered citations for a turn. The FIRST occurrence of a marker is
 * authoritative — that is the one the model was looking at when it wrote the
 * marker into its answer.
 */
export function knowledgeCitationsFromInvocations(
  invocations: unknown[],
): Map<number, KnowledgeCitation> {
  const citations = new Map<number, KnowledgeCitation>();
  const add = (citation: KnowledgeCitation) => {
    if (!citation.key || !Number.isFinite(citation.n)) return;
    if (!citations.has(citation.n)) citations.set(citation.n, citation);
  };

  forEachKnowledgeInvocation(invocations, (record) => {
    const result = record.result as Record<string, unknown> | undefined;
    const details = result?.details as Record<string, unknown> | undefined;
    const hits = Array.isArray(details?.hits) ? details.hits : [];
    for (const raw of hits) {
      if (!raw || typeof raw !== "object") continue;
      const hit = raw as Record<string, unknown>;
      if (typeof hit.citation !== "number") continue;
      const split = splitPageDocumentKey(
        typeof hit.documentKey === "string" ? hit.documentKey : "",
      );
      add({
        n: hit.citation,
        key: split.key,
        page: typeof hit.pageNumber === "number" ? hit.pageNumber : split.page,
        quote: typeof hit.quote === "string" ? hit.quote : undefined,
        documentUrl:
          typeof hit.documentUrl === "string" && hit.documentUrl
            ? hit.documentUrl
            : undefined,
      });
    }

    // Fallback: recover markers from the rendered text.
    const texts: string[] = [];
    const content = Array.isArray(result?.content) ? result.content : [];
    for (const block of content) {
      const text = (block as Record<string, unknown>)?.text;
      if (typeof text === "string") texts.push(text);
    }
    if (typeof record.output_preview === "string") {
      texts.push(record.output_preview);
    }
    for (const text of texts) {
      for (const match of text.matchAll(
        /^\s*\[(\d+)\][^\n]*\n\s*Source:\s*(.+?)(?:\s+\(page (\d+)\))?(?:\s+\(edition \d+\))?(?:\s+\[[^\]]*\])?\s*$/gm,
      )) {
        const split = splitPageDocumentKey(match[2].trim());
        add({
          n: Number(match[1]),
          key: split.key,
          page: match[3] ? Number(match[3]) : split.page,
        });
      }
    }
  });

  // MCP knowledge servers number their rendered passages 1..k per call, so
  // the marker for a row is its 1-based index. First-occurrence-wins keeps
  // the first search's numbering authoritative across multiple searches.
  forEachMcpKnowledgeInvocation(invocations, (rows) => {
    rows.forEach((row, index) => {
      const split = splitPageDocumentKey(
        typeof row.id === "string" ? row.id : "",
      );
      add({
        n: index + 1,
        key: split.key,
        page: typeof row.pageNumber === "number" ? row.pageNumber : split.page,
        quote:
          typeof row.text === "string" ? row.text.slice(0, 280) : undefined,
        documentUrl:
          typeof row.documentUrl === "string" && row.documentUrl
            ? row.documentUrl
            : undefined,
      });
    });
  });

  return citations;
}

/**
 * Extract cited documents from a turn's tool invocations. Order of first
 * citation is preserved; the first citation of a document wins its page.
 */
export function knowledgeSourcesFromInvocations(
  invocations: unknown[],
): KnowledgeSource[] {
  const sources: KnowledgeSource[] = [];
  const seen = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(
      /^\s*Source:\s*(.+?)(?:\s+\(page (\d+)\))?(?:\s+\(edition \d+\))?(?:\s+\[[^\]]*\])?\s*$/gm,
    )) {
      const split = splitPageDocumentKey(match[1].trim());
      const key = split.key;
      if (key && !seen.has(key)) {
        seen.add(key);
        sources.push({
          key,
          page: match[2] ? Number(match[2]) : split.page,
        });
      }
    }
  };
  for (const value of invocations) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const name =
      (typeof record.tool_name === "string" && record.tool_name) ||
      (typeof record.toolName === "string" && record.toolName) ||
      (typeof record.name === "string" && record.name) ||
      "";
    if (name !== "search_knowledge") continue;
    const result = record.result as Record<string, unknown> | undefined;
    // Structured hits first: they carry the retrieval-supplied view URL the
    // text rendering cannot.
    const details = result?.details as Record<string, unknown> | undefined;
    const hits = Array.isArray(details?.hits) ? details.hits : [];
    let sawStructured = false;
    for (const raw of hits) {
      if (!raw || typeof raw !== "object") continue;
      const hit = raw as Record<string, unknown>;
      if (typeof hit.documentKey !== "string" || !hit.documentKey) continue;
      sawStructured = true;
      const split = splitPageDocumentKey(hit.documentKey);
      if (split.key && !seen.has(split.key)) {
        seen.add(split.key);
        sources.push({
          key: split.key,
          page:
            typeof hit.pageNumber === "number" ? hit.pageNumber : split.page,
          documentUrl:
            typeof hit.documentUrl === "string" && hit.documentUrl
              ? hit.documentUrl
              : undefined,
        });
      }
    }
    if (sawStructured) continue;
    const content = Array.isArray(result?.content) ? result.content : [];
    for (const block of content) {
      const text = (block as Record<string, unknown>)?.text;
      if (typeof text === "string") collect(text);
    }
    if (typeof record.output_preview === "string") {
      collect(record.output_preview);
    }
  }
  forEachMcpKnowledgeInvocation(invocations, (rows) => {
    for (const row of rows) {
      const split = splitPageDocumentKey(
        typeof row.id === "string" ? row.id : "",
      );
      if (!split.key || seen.has(split.key)) continue;
      seen.add(split.key);
      sources.push({
        key: split.key,
        page: typeof row.pageNumber === "number" ? row.pageNumber : split.page,
        documentUrl:
          typeof row.documentUrl === "string" && row.documentUrl
            ? row.documentUrl
            : undefined,
      });
    }
  });
  return sources;
}

// ---------------------------------------------------------------------------
// Inline markers
// ---------------------------------------------------------------------------

/**
 * Href the marker rewrite emits, carrying a comma-joined list of citation
 * numbers: `#thinkwork-cite-2,3`. A fragment href — not a custom URI scheme —
 * because markdown renderers sanitize unknown schemes (see the web learning
 * doc docs/solutions/ui-bugs/inline-citations-shipped-inert-twice-2026-07-25.md).
 */
export const CITATION_HREF_PREFIX = "#thinkwork-cite-";

/** Human label for a citation: file name, plus page when present. */
export function citationLabel(citation: KnowledgeCitation): string {
  const base = citation.key.slice(citation.key.lastIndexOf("/") + 1);
  const withoutExt = base.replace(/\.(pdf|docx?|xlsx?|pptx?|md|txt)$/i, "");
  return citation.page ? `${withoutExt} · p.${citation.page}` : withoutExt;
}

/** File name shown for a cited document (the key's last path segment). */
export function knowledgeDocumentFileName(documentKey: string): string {
  const base = documentKey.slice(documentKey.lastIndexOf("/") + 1);
  return base || documentKey;
}

/**
 * Rewrite bare `[n]` markers into links the markdown renderer hands back to
 * us. A run of adjacent markers becomes ONE link carrying every number, so
 * the renderer can collapse them into a single "+N" pill. Markers already
 * inside a markdown link, an image, or a code span are left untouched;
 * unresolvable markers are escaped rather than left bare.
 */
export function linkCitationMarkers(
  markdown: string,
  citations: Map<number, KnowledgeCitation>,
): string {
  if (citations.size === 0) return markdown;

  const segments = markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(
        /(!?)((?:\[\d+\][ \t]*)+)(\()?/g,
        (whole, bang: string, run: string, paren) => {
          if (bang || paren) return whole;
          const numbers = [...run.matchAll(/\[(\d+)\]/g)].map((m) =>
            Number(m[1]),
          );
          const known = numbers.filter((n) => citations.has(n));
          if (known.length === 0) {
            return numbers.map((n) => `\\[${n}\\]`).join("");
          }
          return `[${known[0]}](${CITATION_HREF_PREFIX}${known.join(",")})`;
        },
      );
    })
    .join("");
}

/** Resolve a `#thinkwork-cite-` href back to the citations it names. */
export function citationsFromHref(
  href: string | undefined,
  citations: Map<number, KnowledgeCitation>,
): KnowledgeCitation[] {
  if (!href?.startsWith(CITATION_HREF_PREFIX)) return [];
  return href
    .slice(CITATION_HREF_PREFIX.length)
    .split(",")
    .map((part) => citations.get(Number(part.trim())))
    .filter((c): c is KnowledgeCitation => !!c);
}

// ---------------------------------------------------------------------------
// Opening documents
// ---------------------------------------------------------------------------

/**
 * True for the signed doc-link shape knowledge servers mint: an https
 * `…/kb/doc` URL whose query carries the full key, expiry, and signature
 * (http allowed only for loopback dev servers). Regex-based — `new URL()`
 * is not reliable on Hermes.
 */
export function isSignedDocLink(url: string): boolean {
  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)\?(.*)$/.exec(url);
  if (!match) return false;
  const [, protocol, host, pathname, query] = match;
  const hostname = host.replace(/:\d+$/, "");
  const loopback = hostname === "localhost" || hostname === "127.0.0.1";
  if (protocol !== "https" && !(protocol === "http" && loopback)) return false;
  if (!pathname.endsWith("/kb/doc")) return false;
  const params = new Set(
    query
      .split("&")
      .map((pair) => {
        const eq = pair.indexOf("=");
        return eq > 0 && pair.length > eq + 1 ? pair.slice(0, eq) : "";
      })
      .filter(Boolean),
  );
  return ["key", "exp", "sig"].every((param) => params.has(param));
}

export interface OpenableKnowledgeDocument {
  key: string;
  page?: number;
  documentUrl?: string;
}

/** Extensions the browser/WebView cannot render from the raw signed link.
 * Mirrors web's DOCUMENT_VIEWER_EXTENSIONS (knowledge-doc-viewer.ts). */
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

/**
 * The URL the in-app viewer sheet should load for a cited document, or null
 * when the citation carries no retrieval-supplied URL (the only resolvable
 * open path). Native formats honour `#page=` in the WebView's PDF viewer;
 * Office formats render via iOS QuickLook after the /kb/doc 302 to S3.
 */
export function knowledgeDocumentViewUrl(
  source: OpenableKnowledgeDocument,
): string | null {
  const url = source.documentUrl;
  if (!url) return null;
  return source.page ? `${url}#page=${source.page}` : url;
}
