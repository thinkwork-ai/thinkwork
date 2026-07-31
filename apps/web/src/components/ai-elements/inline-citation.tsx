import { useCallback, useState } from "react";
import { FileText } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import { openKnowledgeDocument } from "@/lib/knowledge-doc-viewer";
import type { KnowledgeCitation } from "./sources";

/**
 * Inline source citations, following the AI Elements InlineCitation
 * shape: a citation *pill naming the source* sits inline with the sentence it
 * supports, and hovering it reveals the document and the quoted passage.
 *
 * The pill shows the document — "CX-0215 · p.1" — not a bare footnote number.
 * A number is a lookup task: the reader has to leave the sentence, find the
 * matching entry, and come back. Naming the source in place is the entire
 * point of the component, and it is what makes a claim checkable at a glance.
 *
 * Consecutive markers collapse into one pill with a "+N" count, matching the
 * upstream trigger's behaviour, so `[1][2][3]` does not produce three pills
 * jammed together mid-sentence.
 */

/**
 * Custom element the markdown rewrite emits, carrying a comma-joined list of
 * citation numbers: `<cite data-cite="2,3"></cite>`.
 *
 * A custom tag, not a link with a custom URI scheme: the markdown renderer
 * sanitizes hrefs and replaces an unknown scheme with a literal "[blocked]"
 * placeholder, so `thinkwork-cite:2` never reaches the anchor override.
 * `allowedTags` is the renderer's documented extension point for exactly
 * this — entity/mention tags in AI output.
 */
export const CITATION_HREF_PREFIX = "#thinkwork-cite-";

/** Human label for a citation: file name, plus page when the passage came
 * from one page of a transcribed document. */
export function citationLabel(citation: KnowledgeCitation): string {
  const base = citation.key.slice(citation.key.lastIndexOf("/") + 1);
  const withoutExt = base.replace(/\.(pdf|docx?|xlsx?|pptx?|md|txt)$/i, "");
  return citation.page ? `${withoutExt} · p.${citation.page}` : withoutExt;
}

/** One row in the hover card: the document, its page, and the passage. */
function CitationSource({
  citation,
  onOpen,
}: {
  citation: KnowledgeCitation;
  onOpen: (citation: KnowledgeCitation) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-1.5">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words font-medium">
          {citationLabel(citation)}
        </span>
      </div>
      {citation.quote ? (
        <blockquote className="border-l-2 pl-2 text-muted-foreground">
          {citation.quote}
        </blockquote>
      ) : null}
      <button
        type="button"
        onClick={() => onOpen(citation)}
        className="justify-self-start text-primary hover:underline"
      >
        {`Open document${citation.page ? ` at page ${citation.page}` : ""}`}
      </button>
    </div>
  );
}

export function InlineCitation({
  citations,
  className,
}: {
  /** Every passage this marker run refers to; at least one. */
  citations: KnowledgeCitation[];
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  // Only retrieval-supplied URLs are resolvable: MCP knowledge servers
  // presign access to their own documents. (THINK-402 removed the KB
  // Files API, which was the only other resolver.) Office formats route to
  // the in-app viewer tab; native formats open the URL directly.
  const open = useCallback((citation: KnowledgeCitation) => {
    setError(null);
    try {
      openKnowledgeDocument(citation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open source");
    }
  }, []);

  const [primary, ...rest] = citations;
  if (!primary) return null;

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => open(primary)}
          aria-label={`Open source ${citationLabel(primary)}`}
          className={cn(
            "mx-0.5 inline-flex shrink-0 items-center gap-1",
            "rounded-full border border-border bg-muted/70 px-2 py-0.5 align-baseline",
            "text-[11px] font-medium leading-4 text-muted-foreground",
            "transition-colors hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          <FileText className="h-2.5 w-2.5 shrink-0" />
          {/* 75px keeps the pill from swallowing the sentence it annotates —
              the full name and page are one hover away in the card. */}
          <span className="max-w-[75px] truncate">
            {citationLabel(primary)}
          </span>
          {rest.length > 0 ? (
            <span className="shrink-0 tabular-nums opacity-70">
              +{rest.length}
            </span>
          ) : null}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 text-xs">
        <div className="grid gap-3">
          {citations.map((citation) => (
            <CitationSource
              key={citation.n}
              citation={citation}
              onOpen={open}
            />
          ))}
          {error ? <p className="text-destructive">{error}</p> : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Rewrite bare `[n]` markers into links the markdown renderer hands back to
 * us, so citations survive markdown parsing without a custom remark plugin.
 *
 * A run of adjacent markers becomes ONE link carrying every number, so the
 * renderer can collapse them into a single "+N" pill.
 *
 * Only markers the turn actually returned are rewritten — the model can write
 * `[0]` or `[9]` by mistake, and an unresolvable pill is worse than plain
 * text. Markers already inside a markdown link, an image, or a fenced/inline
 * code span are left exactly as they are.
 */
export function linkCitationMarkers(
  markdown: string,
  citations: Map<number, KnowledgeCitation>,
): string {
  if (citations.size === 0) return markdown;

  // Split on fenced blocks and inline code so nothing inside them is touched.
  const segments = markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return segments
    .map((segment, index) => {
      // Odd indices are the captured code spans.
      if (index % 2 === 1) return segment;
      // A run of markers, optionally separated by spaces, optionally followed
      // by `(` — which would mean the last one is really a markdown link.
      return segment.replace(
        /(!?)((?:\[\d+\][ \t]*)+)(\()?/g,
        (whole, bang: string, run: string, paren) => {
          // `![n](` is an image and `[n](` is already a link — leave both.
          if (bang || paren) return whole;
          const numbers = [...run.matchAll(/\[(\d+)\]/g)].map((m) =>
            Number(m[1]),
          );
          const known = numbers.filter((n) => citations.has(n));
          // Nothing resolvable: ESCAPE the markers rather than leave them
          // bare. The markdown renderer treats a lone `[9]` as an unfinished
          // link and emits a visible `](streamdown:incomplete-link)`.
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
