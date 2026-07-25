import { useCallback, useMemo, useState } from "react";
import { BookOpen, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDocumentViewUrlByKey } from "@/lib/kb-files-api";

/**
 * Knowledge-base citations for one agent turn (AI-Elements-style Sources
 * block): "Used N sources" collapsible, one row per distinct document the
 * turn's `search_knowledge` calls returned passages from. Clicking a row
 * resolves a presigned view URL for the original file (rendered inline for
 * PDFs/text, downloaded otherwise) — the KB manifest is the lookup key, so
 * this works for managed uploads and connected external buckets alike.
 */

/** One cited document, with the page the passage came from when the runtime
 * reported one (transcribed documents are ingested one page at a time). */
export interface KnowledgeSource {
  key: string;
  /** 1-based page of the source document, used to deep-link the viewer. */
  page?: number;
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
      add({
        n: hit.citation,
        key: typeof hit.documentKey === "string" ? hit.documentKey : "",
        page: typeof hit.pageNumber === "number" ? hit.pageNumber : undefined,
        quote: typeof hit.quote === "string" ? hit.quote : undefined,
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
        add({
          n: Number(match[1]),
          key: match[2].trim(),
          page: match[3] ? Number(match[3]) : undefined,
        });
      }
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
      const key = match[1].trim();
      // First citation wins the page: the same document may be cited from
      // several pages, and the row can only open one of them.
      if (key && !seen.has(key)) {
        seen.add(key);
        sources.push({
          key,
          page: match[2] ? Number(match[2]) : undefined,
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
    const content = Array.isArray(result?.content) ? result.content : [];
    for (const block of content) {
      const text = (block as Record<string, unknown>)?.text;
      if (typeof text === "string") collect(text);
    }
    if (typeof record.output_preview === "string") {
      collect(record.output_preview);
    }
  }
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
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(
    () =>
      sources.map((source) => ({
        key: source.key,
        page: source.page,
        name: displayName(source.key),
      })),
    [sources],
  );

  const openSource = useCallback(async (documentKey: string, page?: number) => {
    setError(null);
    setOpening(documentKey);
    // Open the tab synchronously — popup blockers kill window.open calls
    // issued after an await.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = await getDocumentViewUrlByKey(documentKey);
      // PDF viewers honour the #page= fragment, so a citation lands on the
      // page the passage was actually read from.
      const target = page ? `${url}#page=${page}` : url;
      if (tab) {
        tab.location.href = target;
      } else {
        window.location.href = target;
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Failed to open source");
    } finally {
      setOpening(null);
    }
  }, []);

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
          {names.map(({ key, name, page }) => (
            <li key={key} className="min-w-0">
              <button
                type="button"
                className="flex min-w-0 max-w-full items-center gap-1.5 text-left text-xs text-primary hover:underline"
                title={page ? `${key} (page ${page})` : key}
                onClick={() => void openSource(key, page)}
              >
                {opening === key ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                )}
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
