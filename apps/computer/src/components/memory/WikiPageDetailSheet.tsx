import { useQuery } from "urql";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  PAGE_TYPE_BADGE_CLASSES,
  PAGE_TYPE_BORDER_CLASSES,
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
}

/**
 * Compiled wiki-page detail sheet for apps/computer's Pages tab.
 * Read-only — no edit, no archive. Adapted from
 * apps/admin/src/components/WikiPageSheet.tsx; identical behavior since
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
}: WikiPageDetailSheetProps) {
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

      <div className="flex-1 overflow-y-auto px-6 pt-4 space-y-5">
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
                  .map((s: any) => (
                    <div key={s.id}>
                      <h4 className="text-sm font-semibold text-foreground mb-1">
                        {s.heading}
                      </h4>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {s.bodyMd}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}

        {connectedEdges.length > 0 && onEdgeClick && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Connected pages
            </h4>
            <div className="space-y-2">
              {connectedEdges.map((edge, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm rounded-md bg-muted/30 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => onEdgeClick(edge)}
                >
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] mt-0.5 ${
                      PAGE_TYPE_BORDER_CLASSES[
                        edge.targetType?.toUpperCase() as WikiPageType
                      ] ?? "border-muted text-muted-foreground"
                    }`}
                  >
                    Page
                  </Badge>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {edge.targetLabel}
                    </p>
                    {edge.label && edge.label !== "references" && (
                      <p className="text-xs text-muted-foreground">
                        {edge.label}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
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
