import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "urql";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  DataTable,
  Input,
  Sheet,
  SheetContent,
  ToggleGroup,
  ToggleGroupItem,
} from "@thinkwork/ui";
import {
  WikiGraph,
  type WikiGraphHandle,
  type WikiGraphNode,
  type WikiPageType,
  pageTypeLabel,
} from "@thinkwork/graph";
import {
  ComputerRecentWikiPagesQuery,
  ComputerWikiSearchQuery,
} from "@/lib/graphql-queries";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { useTenant } from "@/context/TenantContext";
import {
  WikiPageDetailSheet,
  type WikiPageSheetEdge,
} from "@/components/memory/WikiPageDetailSheet";

type PagesView = "table" | "graph";
const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

type WikiRow = {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
  summary: string | null;
  lastCompiledAt: string | null;
  updatedAt: string | null;
};

function PageTypeBadge({ type }: { type: WikiPageType }) {
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {pageTypeLabel(type)}
    </Badge>
  );
}

export function SettingsWiki() {
  const { tenantId } = useTenant();
  const [view, setView] = useState<PagesView>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<WikiGraphHandle>(null);
  usePageHeaderActions({
    title: "Wiki Memory",
    breadcrumbs: [{ label: "Wiki Memory" }],
  });

  const requesterUserId = null;
  const effectiveTenantId = tenantId ?? null;

  const [listResult] = useQuery<{ recentWikiPages?: any[] | null }>({
    query: ComputerRecentWikiPagesQuery,
    variables: { tenantId: effectiveTenantId, userId: requesterUserId },
    pause: !!activeSearch || !effectiveTenantId,
  });

  const [searchResult] = useQuery<{
    wikiSearch?:
      | { score: number; matchedAlias: string | null; page: any }[]
      | null;
  }>({
    query: ComputerWikiSearchQuery,
    variables: {
      tenantId: effectiveTenantId,
      userId: requesterUserId,
      query: activeSearch,
      limit: 50,
    },
    pause: !activeSearch || !effectiveTenantId,
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<WikiRow | null>(null);

  const [graphNode, setGraphNode] = useState<WikiGraphNode | null>(null);
  const [graphNodeEdges, setGraphNodeEdges] = useState<WikiPageSheetEdge[]>([]);
  const [graphSheetOpen, setGraphSheetOpen] = useState(false);
  const [graphNodeHistory, setGraphNodeHistory] = useState<
    { node: WikiGraphNode; edges: WikiPageSheetEdge[] }[]
  >([]);

  const toRow = useCallback(
    (p: any): WikiRow => ({
      id: p.id,
      type: p.type as WikiPageType,
      slug: p.slug,
      title: p.title,
      summary: p.summary ?? null,
      lastCompiledAt: p.lastCompiledAt ?? null,
      updatedAt: p.updatedAt ?? null,
    }),
    [],
  );

  const rows: WikiRow[] = useMemo(() => {
    if (activeSearch) {
      const hits = searchResult.data?.wikiSearch ?? [];
      return hits.map((h) => toRow(h.page));
    }
    return (listResult.data?.recentWikiPages ?? []).map(toRow);
  }, [activeSearch, searchResult.data, listResult.data, toRow]);

  const columns: ColumnDef<WikiRow>[] = useMemo(
    () => [
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} font-medium`}>
            <span className="truncate">{row.original.title}</span>
          </span>
        ),
      },
      {
        accessorKey: "type",
        header: "Type",
        size: 110,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <PageTypeBadge type={row.original.type} />
          </span>
        ),
      },
      {
        accessorKey: "summary",
        header: "Summary",
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            <span className="truncate">{row.original.summary ?? "—"}</span>
          </span>
        ),
      },
    ],
    [],
  );

  const isLoading = activeSearch
    ? searchResult.fetching && !searchResult.data
    : listResult.fetching && !listResult.data;

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Wiki Memory"
        description="Browse the wiki compounded from your agents' memories."
      />
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <div className="relative w-fit min-w-56 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && setActiveSearch(searchQuery.trim())
            }
            className="pl-9"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                setActiveSearch("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as PagesView)}
          variant="outline"
          className="ml-auto"
        >
          <ToggleGroupItem value="table" className="px-3 text-xs">
            Table
          </ToggleGroupItem>
          <ToggleGroupItem value="graph" className="px-3 text-xs">
            Graph
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="min-h-0 flex-1">
        {view === "graph" ? (
          <div className="relative h-full overflow-hidden rounded-lg border border-border">
            {effectiveTenantId ? (
              <WikiGraph
                ref={graphRef}
                tenantId={effectiveTenantId}
                useRequesterScope
                searchQuery={searchQuery || undefined}
                onNodeClick={(node, edges) => {
                  setGraphNode(node);
                  setGraphNodeEdges(edges);
                  setGraphNodeHistory([]);
                  setGraphSheetOpen(true);
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            )}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading pages...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Sparkles className="h-12 w-12 text-muted-foreground/40" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {activeSearch
                ? "No pages match your search."
                : "No compiled pages yet. They appear after requester memory is summarized."}
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            onRowClick={(row) => {
              setSelectedRow(row);
              setSheetOpen(true);
            }}
            scrollable
            allowHorizontalScroll={false}
            pageSize={25}
            tableClassName="table-fixed"
          />
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex flex-col sm:max-w-lg">
          {selectedRow && effectiveTenantId && (
            <WikiPageDetailSheet
              tenantId={effectiveTenantId}
              userId={requesterUserId}
              type={selectedRow.type}
              slug={selectedRow.slug}
              title={selectedRow.title}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={graphSheetOpen} onOpenChange={setGraphSheetOpen}>
        <SheetContent className="flex flex-col sm:max-w-lg">
          {graphNode && effectiveTenantId && (
            <WikiPageDetailSheet
              tenantId={effectiveTenantId}
              userId={graphNode.agentId || requesterUserId}
              type={graphNode.entityType}
              slug={graphNode.slug}
              title={graphNode.label}
              connectedEdges={graphNodeEdges}
              historyDepth={graphNodeHistory.length}
              onBack={() => {
                const prev = graphNodeHistory[graphNodeHistory.length - 1];
                if (!prev) return;
                setGraphNodeHistory((h) => h.slice(0, -1));
                setGraphNode(prev.node);
                setGraphNodeEdges(prev.edges);
              }}
              onEdgeClick={(edge) => {
                const result = graphRef.current?.getNodeWithEdges(
                  edge.targetId,
                );
                if (result && graphNode) {
                  setGraphNodeHistory((h) => [
                    ...h,
                    { node: graphNode, edges: graphNodeEdges },
                  ]);
                  setGraphNode(result.node);
                  setGraphNodeEdges(result.edges);
                }
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
