import { useCallback, useMemo, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKnowledgeDocumentOpener } from "@/components/documents/knowledge-doc-open-context";

/**
 * Source citations for one agent turn (AI-Elements-style Sources
 * block): "Used N sources" collapsible, one row per distinct document the
 * turn's retrieval calls returned passages from. Clicking a row opens the
 * document when a retrieval-supplied URL is present — Office formats in
 * the in-app viewer, native formats via the URL itself.
 */

/**
 * Split a `<key>#p=<n>` page-document id into its source key and page.
 *
 * Paginated documents can be ingested one document per page, so the runtime's
 * citation lines can carry the page suffix. Lookup keys on the SOURCE
 * document, so the suffix has to come off here.
 */
export function splitPageDocumentKey(raw: string): {
  key: string;
  page?: number;
} {
  const match = /^(.*)#p=(\d+)$/.exec(raw);
  if (!match) return { key: raw };
  return { key: match[1], page: Number(match[2]) };
}

/** One cited document, with the page the passage came from when the runtime
 * reported one (transcribed documents are ingested one page at a time). */
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
  /** Excerpt shown in the citation hover card. */
  quote?: string;
  /** Retrieval-supplied view URL (MCP knowledge servers own their documents
   * and presign access per hit). Preferred over the KB Files API — the key
   * may not exist in this deployment's own document store. */
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
 * Structured hit rows from an MCP knowledge-server invocation.
 *
 * When retrieval runs as a plain MCP tool (an attached knowledge server like
 * the brain's `brain_knowledge_search`, not a bound KB), the container records
 * the full MCP response under `result.details.raw`; knowledge servers return
 * `structuredContent.results` rows `{id, title, text, score, documentUrl?}`
 * where `id` may carry a `#p=<n>` page suffix. Recognition is by the server's
 * REAL tool name in `details.mcp_tool_name` — the exposed AgentTool name may
 * be hash-truncated.
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
    Record<string, unknown> | undefined;
  const rows = structured?.results ?? structured?.hits;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object",
  );
}

/**
 * Grounded-answer citations from a brain_ask / brain_ask_result MCP
 * invocation. brain_ask answers from held documents and reports what it
 * cited as `structuredContent.citations` rows `{n, source, doc_link,
 * excerpt_ref}` — `excerpt_ref` carries the `#p=<n>` page suffix and
 * `doc_link` is the brain's own presigned viewer URL (the document lives in
 * the brain's store, not this deployment's KB Files API). Recognition is by
 * the server's REAL tool name in `details.mcp_tool_name`, mirroring
 * brainAskCitations in data-sources.tsx.
 */
function brainAskKnowledgeRows(
  record: Record<string, unknown>,
): Record<string, unknown>[] {
  const result = record.result as Record<string, unknown> | undefined;
  const details = result?.details as Record<string, unknown> | undefined;
  const mcpTool =
    typeof details?.mcp_tool_name === "string" ? details.mcp_tool_name : "";
  if (!/brain_ask/i.test(mcpTool)) return [];
  const raw = details?.raw as Record<string, unknown> | undefined;
  const structured = raw?.structuredContent as
    Record<string, unknown> | undefined;
  const rows = structured?.citations;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object",
  );
}

/** Iterate the brain_ask invocations of one turn that carry KB citations. */
function forEachBrainAskInvocation(
  invocations: unknown[],
  visit: (rows: Record<string, unknown>[]) => void,
): void {
  for (const value of invocations) {
    if (!value || typeof value !== "object") continue;
    const rows = brainAskKnowledgeRows(value as Record<string, unknown>);
    if (rows.length > 0) visit(rows);
  }
}

/** One brain_ask citation row → the shared citation fields, or null. */
function brainAskCitationFields(
  row: Record<string, unknown>,
): { key: string; page?: number; documentUrl?: string } | null {
  const ref =
    (typeof row.excerpt_ref === "string" && row.excerpt_ref) ||
    (typeof row.source === "string" && row.source) ||
    "";
  const split = splitPageDocumentKey(ref);
  if (!split.key) return null;
  return {
    key: split.key,
    page: split.page,
    documentUrl:
      typeof row.doc_link === "string" && row.doc_link
        ? row.doc_link
        : undefined,
  };
}

/** Iterate the MCP knowledge-server invocations of one turn. */
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
 * Numbered citations for a turn, newest-wins-never: the FIRST occurrence of a
 * marker is authoritative, because that is the one the model was looking at
 * when it wrote the marker into its answer.
 *
 * Prefers the structured `details.hits` the Pi runner returns — parsing the
 * rendered text is a fallback for ledger-shaped records that only kept an
 * output preview.
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

  // MCP knowledge servers number their rendered passages 1..k per call (the
  // model reads "[n] …" lines), so the marker for a row is its 1-based index.
  // First-occurrence-wins (the map's add) keeps the first search's numbering
  // authoritative when a turn searches more than once.
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

  // brain_ask grounded answers carry their own [n] markers; the row's `n`
  // is authoritative. First-occurrence-wins keeps the earlier ask's
  // numbering when a turn asks more than once.
  forEachBrainAskInvocation(invocations, (rows) => {
    for (const row of rows) {
      if (typeof row.n !== "number") continue;
      const fields = brainAskCitationFields(row);
      if (!fields) continue;
      add({ n: row.n, ...fields });
    }
  });

  return citations;
}

/**
 * Extract cited documents from a turn's tool invocations. Handles both the Pi
 * runner shape ({name, result.content[].text}) and the ledger shape
 * ({tool_name, output_preview}). Order of first citation is preserved.
 *
 * The runtime emits `Source: <key>` followed by optional ` (page N)`,
 * ` (edition N)` and ` [transcribed…]` suffixes; the key must come back
 * unadorned or the presigned-URL lookup misses.
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
      // First citation wins the page: the same document may be cited from
      // several pages, and the row can only open one of them.
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
  // MCP knowledge-server hits: same dedupe, first citation wins the page.
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
  // brain_ask grounded-answer citations: same dedupe, first wins the page.
  forEachBrainAskInvocation(invocations, (rows) => {
    for (const row of rows) {
      const fields = brainAskCitationFields(row);
      if (!fields || seen.has(fields.key)) continue;
      seen.add(fields.key);
      sources.push(fields);
    }
  });
  return sources;
}

/** Back-compat: callers that only need the keys. */
export function knowledgeSourceKeysFromInvocations(
  invocations: unknown[],
): string[] {
  return knowledgeSourcesFromInvocations(invocations).map(
    (source) => source.key,
  );
}

function displayName(documentKey: string): string {
  const base = documentKey.slice(documentKey.lastIndexOf("/") + 1);
  return base || documentKey;
}

export function KnowledgeSourcesCard({
  sources,
  className,
}: {
  sources: KnowledgeSource[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(
    () =>
      sources.map((source) => ({
        key: source.key,
        page: source.page,
        documentUrl: source.documentUrl,
        name: displayName(source.key),
      })),
    [sources],
  );

  // Inside a thread the opener docks the document in the artifact side
  // panel; elsewhere it falls back to the new-tab flow. Synchronous on
  // purpose — popup blockers kill tabs opened after an await.
  const openDocument = useKnowledgeDocumentOpener();
  const openSource = useCallback(
    (documentKey: string, page?: number, documentUrl?: string) => {
      setError(null);
      try {
        openDocument({ key: documentKey, page, documentUrl });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to open source");
      }
    },
    [openDocument],
  );

  if (sources.length === 0) return null;

  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        Used {sources.length} {sources.length === 1 ? "source" : "sources"}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", {
            "rotate-180": open,
          })}
        />
      </button>
      {open ? (
        <ul className="mt-1.5 grid gap-1">
          {names.map(({ key, name, page, documentUrl }) => (
            <li key={key} className="min-w-0">
              <button
                type="button"
                className="flex min-w-0 max-w-full items-center gap-1.5 text-left text-xs text-primary hover:underline"
                title={page ? `${key} (page ${page})` : key}
                onClick={() => openSource(key, page, documentUrl)}
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{name}</span>
                {page ? (
                  <span className="shrink-0 text-muted-foreground">
                    p.{page}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
