import { useCallback, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import { getDocumentViewUrlByKey } from "@/lib/kb-files-api";
import type { KnowledgeCitation } from "./sources";

/**
 * Inline knowledge-base citations (AI-Elements InlineCitation shape).
 *
 * The runtime hands the model a numbered marker per retrieved passage and
 * asks it to place that marker after the claim it supports; this renders each
 * marker as a badge that previews the source on hover and opens the original
 * document — at the cited page — on click.
 *
 * A flat "used N sources" list cannot tell you which document backs which
 * sentence. That is the whole difference this makes: a reader can check one
 * specific claim without re-reading every source.
 *
 * Built on the shared HoverCard rather than the upstream carousel variant —
 * a marker resolves to exactly one passage here, so there is nothing to page
 * through, and it avoids pulling a carousel dependency into the app.
 */

/** Marker text the runtime emits and the model reproduces, e.g. `[3]`. */
export const CITATION_HREF_PREFIX = "thinkwork-cite:";

/** Human label for a citation: file name, plus page when the passage came
 * from one page of a transcribed document. */
function citationLabel(citation: KnowledgeCitation): string {
  const base = citation.key.slice(citation.key.lastIndexOf("/") + 1);
  return citation.page ? `${base} · p.${citation.page}` : base;
}

export function InlineCitation({
  citation,
  className,
}: {
  citation: KnowledgeCitation;
  className?: string;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    setError(null);
    setOpening(true);
    // Open synchronously — popup blockers kill window.open after an await.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = await getDocumentViewUrlByKey(citation.key);
      const target = citation.page ? `${url}#page=${citation.page}` : url;
      if (tab) tab.location.href = target;
      else window.location.href = target;
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Failed to open source");
    } finally {
      setOpening(false);
    }
  }, [citation.key, citation.page]);

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => void open()}
          aria-label={`Open source ${citationLabel(citation)}`}
          className={cn(
            "mx-0.5 inline-flex h-4 min-w-4 shrink-0 translate-y-[-1px] items-center justify-center",
            "rounded-full border border-primary/25 bg-primary/10 px-1 align-middle",
            "text-[10px] font-medium leading-none text-primary tabular-nums",
            "transition-colors hover:bg-primary/20 focus-visible:outline-none",
            "focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
        >
          {opening ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            citation.n
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 text-xs">
        <div className="grid gap-2">
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
            onClick={() => void open()}
            className="justify-self-start text-primary hover:underline"
          >
            Open document{citation.page ? ` at page ${citation.page}` : ""}
          </button>
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
 * Only markers the turn actually returned are rewritten — the model can write
 * `[0]` or `[9]` by mistake, and an unresolvable badge is worse than plain
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
      return segment.replace(
        /(!?)(\[(\d+)\])(\()?/g,
        (whole, bang: string, _marker: string, digits: string, paren) => {
          // `![n](` is an image and `[n](` is already a link — leave both.
          if (bang || paren) return whole;
          // A marker the turn never returned must be ESCAPED, not left bare:
          // the markdown renderer treats a lone `[9]` as an unfinished link
          // and emits a visible `](streamdown:incomplete-link)` placeholder.
          if (!citations.has(Number(digits))) return `\\[${digits}\\]`;
          return `[${digits}](${CITATION_HREF_PREFIX}${digits})`;
        },
      );
    })
    .join("");
}
