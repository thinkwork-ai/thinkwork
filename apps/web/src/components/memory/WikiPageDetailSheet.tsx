import { useQuery } from "urql";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  PAGE_TYPE_BADGE_CLASSES,
  pageTypeLabel,
  type WikiPageType,
} from "@thinkwork/graph";
import {
  Badge,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import { ComputerWikiPageQuery } from "@/lib/graphql-queries";
import {
  NodeBadge,
  RelationshipConnector,
  hashColor,
} from "@/components/memory/relationship-badges";
import { RelatedMemories } from "@/components/memory/RelatedMemories";

export interface WikiPageSheetEdge {
  label: string;
  targetLabel: string;
  targetType: string;
  targetId: string;
}

interface WikiPageDetailSheetProps {
  tenantId: string;
  userId?: string | null;
  type: WikiPageType;
  slug: string;
  /** Title shown until the full page query resolves. */
  title: string;
  connectedEdges?: WikiPageSheetEdge[];
  historyDepth?: number;
  onBack?: () => void;
  onEdgeClick?: (edge: WikiPageSheetEdge) => void;
  /** Community hue for a node label — supplied by the graph host so
   *  badges match the canvas colors; falls back to a stable hash hue. */
  resolveNodeColor?: (label: string) => string | undefined;
}

/** `- Source — relationship — Target` lines from compiled wiki pages. */
const RELATIONSHIP_LINE = /^-?\s*(.+?)\s+—\s+(.+?)\s+—\s+(.+)$/;

function parseRelationshipLines(bodyMd: string) {
  return bodyMd
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(RELATIONSHIP_LINE);
      return match
        ? { source: match[1]!, relationship: match[2]!, target: match[3]! }
        : { raw: line };
    });
}

/**
 * Compiled wiki-page detail sheet for apps/web's Pages tab.
 * Read-only — no edit, no archive. Adapted from
 * apps/web/src/components/WikiPageSheet.tsx; identical behavior since
 * admin's surface is also read-only at this layer.
 */
export function WikiPageDetailSheet({
  tenantId,
  userId,
  type,
  slug,
  title,
  connectedEdges = [],
  historyDepth = 0,
  onBack,
  onEdgeClick,
  resolveNodeColor,
}: WikiPageDetailSheetProps) {
  // Clicking a relationship badge navigates like clicking the matching
  // connected page; the current page and unknown labels are inert.
  const edgeClickFor = (label: string): (() => void) | undefined => {
    if (!onEdgeClick) return undefined;
    const normalized = label.trim().toLowerCase();
    const edge = connectedEdges.find(
      (e) => e.targetLabel.trim().toLowerCase() === normalized,
    );
    return edge ? () => onEdgeClick(edge) : undefined;
  };

  const [pageResult] = useQuery({
    query: ComputerWikiPageQuery,
    variables: { tenantId, userId, type, slug },
    pause: !tenantId || !slug,
  });

  const page: any = pageResult.data?.wikiPage;
  const loadingPage = pageResult.fetching && !pageResult.data;

  return (
    <>
      <SheetHeader className="p-6 pb-0">
        <SheetTitle className="flex items-center gap-2">
          {historyDepth > 0 && onBack && (
            <button
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground -ml-1 mr-1"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <span className="truncate">{page?.title ?? title}</span>
          <Badge
            className={`font-normal text-xs ${
              PAGE_TYPE_BADGE_CLASSES[type] ?? "bg-muted text-muted-foreground"
            }`}
          >
            {pageTypeLabel(type)}
          </Badge>
        </SheetTitle>
        <SheetDescription>
          {pageTypeLabel(type)} page
          {connectedEdges.length > 0
            ? ` — ${connectedEdges.length} link${connectedEdges.length !== 1 ? "s" : ""}`
            : ""}
          {page?.lastCompiledAt
            ? ` · compiled ${new Date(page.lastCompiledAt).toLocaleDateString(
                "en-US",
                {
                  month: "short",
                  day: "numeric",
                },
              )}`
            : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-8 space-y-5">
        {loadingPage ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading page…
          </div>
        ) : !page ? (
          <p className="text-sm text-muted-foreground">
            This page couldn't be loaded. It may have been archived since it was
            last indexed.
          </p>
        ) : (
          <>
            {page.summary && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {page.summary}
              </p>
            )}

            {page.aliases && page.aliases.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">
                  Also known as
                </p>
                <div className="flex flex-wrap gap-1">
                  {page.aliases.map((a: string) => (
                    <Badge
                      key={a}
                      variant="outline"
                      className="font-normal text-xs"
                    >
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {page.sections && page.sections.length > 0 && (
              <div className="space-y-4">
                {[...page.sections]
                  .sort((a: any, b: any) => a.position - b.position)
                  .map((s: any) =>
                    s.heading?.trim().toLowerCase() === "relationships" ? (
                      <div key={s.id}>
                        <h4 className="text-sm font-semibold text-foreground mb-2">
                          {s.heading}
                        </h4>
                        <div className="space-y-1.5">
                          {parseRelationshipLines(s.bodyMd ?? "").map(
                            (row, i) =>
                              "raw" in row ? (
                                <p
                                  key={i}
                                  className="text-sm text-muted-foreground"
                                >
                                  {row.raw}
                                </p>
                              ) : (
                                <div
                                  key={i}
                                  className="flex items-center gap-1.5 overflow-hidden"
                                >
                                  <NodeBadge
                                    label={row.source}
                                    color={
                                      resolveNodeColor?.(row.source) ??
                                      hashColor(row.source)
                                    }
                                    onClick={edgeClickFor(row.source)}
                                  />
                                  <RelationshipConnector
                                    label={row.relationship}
                                  />
                                  <NodeBadge
                                    label={row.target}
                                    color={
                                      resolveNodeColor?.(row.target) ??
                                      hashColor(row.target)
                                    }
                                    onClick={edgeClickFor(row.target)}
                                  />
                                </div>
                              ),
                          )}
                        </div>
                      </div>
                    ) : (
                      <div key={s.id}>
                        <h4 className="text-sm font-semibold text-foreground mb-1">
                          {s.heading}
                        </h4>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                          {s.bodyMd}
                        </p>
                      </div>
                    ),
                  )}
              </div>
            )}
            <RelatedMemories
              tenantId={tenantId}
              userId={userId}
              query={page.title ?? title}
            />
          </>
        )}

        {!loadingPage && page && connectedEdges.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No links to or from this page yet.
          </p>
        )}
      </div>
    </>
  );
}
