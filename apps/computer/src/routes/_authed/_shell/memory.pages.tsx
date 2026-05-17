import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
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
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@thinkwork/ui";
import { MEMORY_TABS } from "./memory";
import {
  PAGE_TYPE_BADGE_CLASSES,
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
import { useTenant } from "@/context/TenantContext";
import {
  WikiPageDetailSheet,
  type WikiPageSheetEdge,
} from "@/components/memory/WikiPageDetailSheet";

type PagesView = "table" | "graph";

const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

function isPagesView(v: unknown): v is PagesView {
  return v === "table" || v === "graph";
}

export const Route = createFileRoute("/_authed/_shell/memory/pages")({
  component: PagesPage,
  validateSearch: (search: Record<string, unknown>): { view?: PagesView } => ({
    ...(isPagesView(search.view) ? { view: search.view } : {}),
  }),
});

interface RecentWikiPagesResult {
  recentWikiPages?: any[] | null;
}

interface WikiSearchResult {
  wikiSearch?:
    | { score: number; matchedAlias: string | null; page: any }[]
    | null;
}

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
    <Badge
      className={`font-normal text-xs ${
        PAGE_TYPE_BADGE_CLASSES[type] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {pageTypeLabel(type)}
    </Badge>
  );
}

function PagesPage() {
  const { tenantId } = useTenant();
  const { view: viewParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab =
    [...MEMORY_TABS]
      .reverse()
      .find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ??
    "";
  const view: PagesView = viewParam ?? "table";
  const setView = useCallback(
    (next: PagesView) => {
      navigate({
        search: next === "table" ? {} : { view: next },
        replace: true,
      });
    },
    [navigate],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<WikiGraphHandle>(null);

  const requesterUserId = null;
  const effectiveTenantId = tenantId ?? null;

  const [listResult] = useQuery<RecentWikiPagesResult>({
    query: ComputerRecentWikiPagesQuery,
    variables: { tenantId: effectiveTenantId, userId: requesterUserId },
    pause: !!activeSearch || !effectiveTenantId,
  });

  const [searchResult] = useQuery<WikiSearchResult>({
    query: ComputerWikiSearchQuery,
    variables: {
      tenantId: effectiveTenantId,
      userId: requesterUserId,
      query: activeSearch,
      limit: 50,
    },
    pause: !activeSearch || !effectiveTenantId,
  });

  // List-row detail sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<WikiRow | null>(null);

  // Graph node detail sheet
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
    const pages = listResult.data?.recentWikiPages ?? [];
    return pages.map(toRow);
  }, [activeSearch, searchResult.data, listResult.data, toRow]);

  const columns: ColumnDef<WikiRow>[] = useMemo(
    () => [
      {
        accessorKey: "lastCompiledAt",
        header: "Date",
        size: 140,
        cell: ({ row }) => {
          const d = row.original.lastCompiledAt ?? row.original.updatedAt;
          return (
            <span
              className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
            >
              {d
                ? new Date(d).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
          );
        },
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
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} font-medium`}>
            <span className="truncate">{row.original.title}</span>
          </span>
        ),
      },
    ],
    [],
  );

  const handleRowClick = useCallback((row: WikiRow) => {
    setSelectedRow(row);
    setSheetOpen(true);
  }, []);

  const handleSearch = () => {
    setActiveSearch(searchQuery.trim());
  };

  const isLoading = activeSearch
    ? searchResult.fetching && !searchResult.data
    : listResult.fetching && !listResult.data;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="relative z-10 flex shrink-0 items-center gap-3 px-4 py-3">
        <div className="relative w-fit min-w-56 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
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
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="pointer-events-auto">
            <Tabs value={activeTab}>
              <TabsList>
                {MEMORY_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.to}
                    value={tab.to}
                    asChild
                    className="px-3 text-xs"
                  >
                    <Link to={tab.to}>{tab.label}</Link>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
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

      <div className="min-h-0 flex-1 px-4">
        {view === "graph" ? (
          <div className="h-full relative border border-border rounded-lg overflow-hidden">
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
            <p className="text-sm text-muted-foreground max-w-sm">
              {activeSearch
                ? "No pages match your search."
                : "No compiled pages yet. They appear after requester memory is summarized."}
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            onRowClick={handleRowClick}
            scrollable
            pageSize={25}
            tableClassName="table-fixed"
          />
        )}
      </div>

      {/* List-row detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col">
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

      {/* Graph-node detail sheet (with re-anchoring history) */}
      <Sheet open={graphSheetOpen} onOpenChange={setGraphSheetOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col">
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
