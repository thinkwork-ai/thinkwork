import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "urql";
import { Loader2, Search, Shapes, Sparkles, X } from "lucide-react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Badge,
  Button,
  DataTable,
  DataTableTokenFilter,
  dataTableTokenFilterFns,
  Input,
  Sheet,
  SheetContent,
  ToggleGroup,
  ToggleGroupItem,
  type DataTableTokenFilterColumn,
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

// Null-rendering header publisher (see SettingsContent's TablePaneHeader). Kept
// as a child so the embedded variant can suppress it without a conditional hook.
function WikiHeader() {
  usePageHeaderActions({
    title: "Wiki Memory",
    breadcrumbs: [{ label: "Wiki Memory" }],
  });
  return null;
}

// Collapsible search matching the Workflows toolbar: a search-icon button that
// expands into an input. Drives the live `searchQuery` (graph) and commits
// `activeSearch` (table) on Enter.
function WikiToolbarSearch({
  searchQuery,
  onSearchQueryChange,
  onCommitSearch,
}: {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onCommitSearch: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || searchQuery.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const clearSearch = () => {
    onSearchQueryChange("");
    onCommitSearch("");
    setExpanded(false);
  };

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-8 w-8 rounded-md"
        aria-label="Search pages"
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(16rem,calc(100vw-2rem))] items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search pages"
        placeholder="Search pages..."
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={searchQuery}
        onBlur={() => {
          if (!searchQuery) setExpanded(false);
        }}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommitSearch(searchQuery.trim());
          if (e.key === "Escape") {
            e.preventDefault();
            clearSearch();
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Clear search"
        onMouseDown={(e) => e.preventDefault()}
        onClick={clearSearch}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

function PageTypeBadge({ type }: { type: WikiPageType }) {
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {pageTypeLabel(type)}
    </Badge>
  );
}

export function SettingsWiki({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useTenant();
  const [view, setView] = useState<PagesView>("graph");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<WikiGraphHandle>(null);

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

  // Client-side faceted filtering over the loaded rows (Type facet), mirroring
  // the Workflows toolbar. A headless filter-only table produces `filteredRows`
  // for the DataTable; free-text search stays server-side via `activeSearch`.
  // The Type facet operates on the human display label (e.g. "Place") so the
  // same selected values drive BOTH the table filter and the graph's
  // `typeFilter` prop (WikiGraph keys nodes by their display-type label).
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const tokenFilterColumns: DataTableTokenFilterColumn[] = useMemo(
    () => [
      {
        id: "type",
        label: "Type",
        type: "option",
        icon: <Shapes className="size-4" />,
        options: Array.from(new Set(rows.map((r) => pageTypeLabel(r.type))))
          .sort()
          .map((value) => ({ value, label: value })),
      },
    ],
    [rows],
  );
  const filterColumns: ColumnDef<WikiRow>[] = useMemo(
    () => [
      {
        id: "type",
        accessorFn: (row) => pageTypeLabel(row.type),
        filterFn: dataTableTokenFilterFns.option,
      },
    ],
    [],
  );
  const filterTable = useReactTable({
    data: rows,
    columns: filterColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const filteredRows = useMemo(
    () => filterTable.getFilteredRowModel().rows.map((r) => r.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterTable.getState().columnFilters, rows],
  );
  // Selected Type labels, forwarded to the graph so the facet dims
  // non-matching nodes in the Graph view too.
  const selectedTypes = useMemo(() => {
    const raw = columnFilters.find((c) => c.id === "type")?.value as
      | { value?: unknown }
      | undefined;
    const v = raw?.value;
    const arr = Array.isArray(v) ? v : v != null ? [v] : [];
    return arr.filter((x): x is string => typeof x === "string");
  }, [columnFilters]);

  const isLoading = activeSearch
    ? searchResult.fetching && !searchResult.data
    : listResult.fetching && !listResult.data;

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {embedded ? null : <WikiHeader />}
      <SettingsPageTitle
        title="Wiki Memory"
        description="Browse the wiki compounded from your agents' memories."
        badge={
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as PagesView)}
            variant="outline"
            className="ml-4 h-8 overflow-hidden rounded-full border bg-background shadow-sm"
          >
            <ToggleGroupItem
              value="graph"
              className="h-full rounded-none border-0 px-3 text-sm font-medium"
            >
              Graph
            </ToggleGroupItem>
            <ToggleGroupItem
              value="table"
              className="h-full rounded-none border-0 border-l border-border px-3 text-sm font-medium"
            >
              Table
            </ToggleGroupItem>
          </ToggleGroup>
        }
      />
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <WikiToolbarSearch
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onCommitSearch={setActiveSearch}
        />
        <DataTableTokenFilter
          table={filterTable}
          columns={tokenFilterColumns}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full [&_[data-token-filter-token]]:shrink-0"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
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
                typeFilter={selectedTypes.length ? selectedTypes : undefined}
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
            data={filteredRows}
            emptyState={
              <div className="py-10 text-center text-sm text-muted-foreground">
                No pages match the current filters.
              </div>
            }
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
              resolveNodeColor={(label) =>
                graphRef.current?.getNodeColorByLabel?.(label)
              }
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
