import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "urql";
import { Database, FolderTree, Search, Shapes, X } from "lucide-react";
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
  ToggleGroup,
  ToggleGroupItem,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";
import {
  MemoryGraph,
  type MemoryGraphHandle,
  type MemoryGraphNode,
} from "@thinkwork/graph";
import {
  ComputerMemoryRecordsQuery,
  ComputerMemoryRetainAttemptsQuery,
  SpacesQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantMembersQuery } from "@/lib/settings-queries";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { useTenant } from "@/context/TenantContext";
import {
  STRATEGY_COLORS,
  inferStrategy,
  strategyLabel,
  stripTopicTags,
} from "@/lib/memory-strategy";
import { isCuratedMemory } from "@/lib/memory-curation";
import {
  MemoryDetailSheet,
  type MemoryRow,
} from "@/components/memory/MemoryDetailSheet";
import {
  MemoryGraphNodeSheet,
  type MemoryGraphEdge,
} from "@/components/memory/MemoryGraphNodeSheet";

type MemoryView = "table" | "graph";
const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

export interface MemoryRefreshController {
  refresh: () => Promise<void>;
  isRefreshing: boolean;
  disabled: boolean;
}

/**
 * THINK-199: raw-units visibility state, published to the parent so the
 * Show/Hide-raw toggle renders in the page header next to the refresh action.
 */
export interface MemoryRawUnitsController {
  showRaw: boolean;
  hiddenCount: number;
  toggle: () => void;
}

// Null-rendering header publisher (see SettingsContent's TablePaneHeader). Kept
// as a child so the embedded variant can suppress it without a conditional hook.
function MemoryHeader() {
  usePageHeaderActions({ title: "Memory", breadcrumbs: [{ label: "Memory" }] });
  return null;
}

// Collapsible search matching the Workflows toolbar: a search-icon button that
// expands into an input. Drives the live `searchQuery` (graph) and commits
// `activeSearch` (records query) on Enter.
function MemoryToolbarSearch({
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
        aria-label="Search Hindsight records"
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(20rem,calc(100vw-2rem))] items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search Hindsight records"
        placeholder="Search Hindsight records..."
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

function StrategyBadge({ strategy }: { strategy: string | null }) {
  if (!strategy) return null;
  const colors = STRATEGY_COLORS[strategy] || "bg-muted text-muted-foreground";
  return (
    <Badge className={`${colors} whitespace-nowrap font-normal text-xs`}>
      {strategyLabel(strategy)}
    </Badge>
  );
}

export function SettingsMemory({
  embedded,
  onRefreshControllerChange,
  onRawUnitsControllerChange,
}: {
  embedded?: boolean;
  onRefreshControllerChange?: (
    controller: MemoryRefreshController | null,
  ) => void;
  onRawUnitsControllerChange?: (
    controller: MemoryRawUnitsController | null,
  ) => void;
} = {}) {
  const { tenantId } = useTenant();
  const [view, setView] = useState<MemoryView>("graph");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<MemoryGraphHandle>(null);

  const effectiveTenantId = tenantId ?? null;
  const requesterUserId = null;
  const namespace = "requester";

  const [spacesResult, reexecuteSpacesQuery] = useQuery<{
    spaces?: Array<{ id: string; name?: string | null; slug?: string | null }>;
  }>({
    query: SpacesQuery,
    variables: { tenantId: effectiveTenantId ?? "" },
    pause: !effectiveTenantId,
  });

  const [membersResult, reexecuteMembersQuery] = useQuery<{
    tenantMembers?: Array<{
      principalType?: string | null;
      principalId?: string | null;
      user?: {
        id?: string | null;
        name?: string | null;
        email?: string | null;
        profile?: { callBy?: string | null } | null;
      } | null;
    }>;
  }>({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: effectiveTenantId ?? "" },
    pause: !effectiveTenantId,
  });

  const [recordsResult, reexecuteRecordsQuery] = useQuery<{
    memoryRecords?: any[] | null;
  }>({
    query: ComputerMemoryRecordsQuery,
    variables: {
      tenantId: effectiveTenantId,
      userId: requesterUserId,
      namespace,
      scope: "OPERATOR",
      query: activeSearch || null,
      limit: 500,
    },
    pause: !effectiveTenantId,
  });

  const [retainAttemptsResult, reexecuteRetainAttemptsQuery] = useQuery<{
    memoryRetainAttempts?: Array<{
      id: string;
      status?: string | null;
      attemptCount?: number | null;
      maxAttempts?: number | null;
      errorClass?: string | null;
      errorMessage?: string | null;
    }> | null;
  }>({
    query: ComputerMemoryRetainAttemptsQuery,
    variables: {
      tenantId: effectiveTenantId ?? "",
      limit: 25,
    },
    pause: !effectiveTenantId,
  });

  const [selectedRecord, setSelectedRecord] = useState<MemoryRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [graphNode, setGraphNode] = useState<MemoryGraphNode | null>(null);
  const [graphNodeEdges, setGraphNodeEdges] = useState<MemoryGraphEdge[]>([]);
  const [graphSheetOpen, setGraphSheetOpen] = useState(false);
  const [graphNodeHistory, setGraphNodeHistory] = useState<
    { node: MemoryGraphNode; edges: MemoryGraphEdge[] }[]
  >([]);

  const mapRecord = useCallback(
    (r: any): MemoryRow => ({
      memoryRecordId: r.memoryRecordId,
      text: r.content?.text ?? "",
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
      namespace: r.namespace ?? null,
      bankId: r.bankId ?? r.namespace ?? null,
      ownerType: r.ownerType ?? null,
      ownerId: r.ownerId ?? null,
      strategy:
        r.strategy ?? inferStrategy(r.strategyId ?? "", r.namespace ?? ""),
      factType: r.factType ?? null,
      confidence: r.confidence ?? null,
      eventDate: r.eventDate ?? null,
      occurredStart: r.occurredStart ?? null,
      occurredEnd: r.occurredEnd ?? null,
      mentionedAt: r.mentionedAt ?? null,
      tags: r.tags ?? null,
      accessCount: r.accessCount ?? 0,
      proofCount: r.proofCount ?? null,
      context: r.context ?? null,
      threadId: r.threadId ?? null,
    }),
    [],
  );

  const rawRecords: any[] = useMemo(() => {
    return recordsResult.data?.memoryRecords ?? [];
  }, [recordsResult.data]);

  const allRows: MemoryRow[] = useMemo(
    () =>
      rawRecords
        .map(mapRecord)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [rawRecords, mapRecord],
  );

  // THINK-199 (Brain Quality P4): the default view shows curated memory —
  // observations, corroborated units, deliberate sources — and hides raw
  // uncorroborated chat-fragment exhaust behind the eye toggle (the
  // THINK-173 show-compiled pattern). Explicit searches always show all.
  const [showRaw, setShowRaw] = useState(false);
  const rawHiddenCount = useMemo(
    () =>
      activeSearch ? 0 : allRows.filter((row) => !isCuratedMemory(row)).length,
    [allRows, activeSearch],
  );
  const rows: MemoryRow[] = useMemo(
    () => (activeSearch || showRaw ? allRows : allRows.filter(isCuratedMemory)),
    [allRows, activeSearch, showRaw],
  );

  const ownerLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const space of spacesResult.data?.spaces ?? []) {
      const label = space.name || space.slug || space.id;
      if (space.id && label) labels.set(`space:${space.id}`, label);
    }
    for (const member of membersResult.data?.tenantMembers ?? []) {
      if (member.principalType?.toUpperCase() !== "USER") continue;
      const user = member.user;
      const userId = user?.id || member.principalId;
      const label =
        user?.profile?.callBy || user?.name || user?.email || userId;
      if (userId && label) labels.set(`user:${userId}`, label);
    }
    return labels;
  }, [membersResult.data, spacesResult.data]);

  const columns: ColumnDef<MemoryRow>[] = useMemo(
    () => [
      {
        accessorKey: "createdAt",
        header: "Date",
        size: 112,
        cell: ({ row }) => (
          <span
            className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
          >
            {row.original.createdAt
              ? new Date(row.original.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "bankId",
        header: "Bank",
        size: 132,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <span className="truncate text-xs">
              {formatBankLabel(row.original, ownerLabels)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "ownerType",
        header: "Scope",
        size: 164,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <span className="truncate text-xs">
              {formatOwnerScope(row.original, ownerLabels)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "factType",
        // Wide enough for the longest strategy label ("Reflections" /
        // "Preferences") so the badge never clips under table-fixed.
        header: "Type",
        size: 124,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <StrategyBadge strategy={row.original.strategy} />
          </span>
        ),
      },
      {
        // No explicit size: under table-fixed this flexes into the remaining
        // width while the cell content truncates on one line.
        accessorKey: "text",
        header: "Memory",
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <span className="truncate">
              {stripTopicTags(row.original.text)}
            </span>
          </span>
        ),
      },
    ],
    [ownerLabels],
  );

  // View-specific facets. The table (memory records) and graph (Hindsight
  // entities) are different datasets with no shared axis, so each view gets
  // facets appropriate to its data:
  //   • Table → Bank / Scope / Type(strategy), filtering the rows.
  //   • Graph → Entity Type (ontology types reported by the graph), dimming
  //     non-matching nodes via MemoryGraph's `typeFilter`.
  const [tableColumnFilters, setTableColumnFilters] =
    useState<ColumnFiltersState>([]);
  const tableFacetColumns: DataTableTokenFilterColumn[] = useMemo(() => {
    const bankOptions = Array.from(
      new Set(rows.map((r) => formatBankLabel(r, ownerLabels))),
    )
      .filter(Boolean)
      .sort()
      .map((value) => ({ value, label: value }));
    const scopeOptions = Array.from(
      new Set(rows.map((r) => formatOwnerScope(r, ownerLabels))),
    )
      .filter(Boolean)
      .sort()
      .map((value) => ({ value, label: value }));
    const typeOptions = Array.from(
      new Set(rows.map((r) => r.strategy).filter((s): s is string => !!s)),
    )
      .sort()
      .map((value) => ({ value, label: strategyLabel(value) }));
    return [
      {
        id: "bank",
        label: "Bank",
        type: "option",
        icon: <Database className="size-4" />,
        options: bankOptions,
      },
      {
        id: "scope",
        label: "Scope",
        type: "option",
        icon: <FolderTree className="size-4" />,
        options: scopeOptions,
      },
      {
        id: "type",
        label: "Type",
        type: "option",
        icon: <Shapes className="size-4" />,
        options: typeOptions,
      },
    ];
  }, [rows, ownerLabels]);
  const tableFilterColumns: ColumnDef<MemoryRow>[] = useMemo(
    () => [
      {
        id: "bank",
        accessorFn: (row) => formatBankLabel(row, ownerLabels),
        filterFn: dataTableTokenFilterFns.option,
      },
      {
        id: "scope",
        accessorFn: (row) => formatOwnerScope(row, ownerLabels),
        filterFn: dataTableTokenFilterFns.option,
      },
      {
        id: "type",
        accessorFn: (row) => row.strategy ?? "",
        filterFn: dataTableTokenFilterFns.option,
      },
    ],
    [ownerLabels],
  );
  const tableFilterTable = useReactTable({
    data: rows,
    columns: tableFilterColumns,
    state: { columnFilters: tableColumnFilters },
    onColumnFiltersChange: setTableColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const filteredRows = useMemo(
    () => tableFilterTable.getFilteredRowModel().rows.map((r) => r.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableFilterTable.getState().columnFilters, rows],
  );

  // Graph facets: Bank + Entity Type. The graph (tenant-wide) reports its
  // banks and ontology types via callbacks; a headless filter table stores the
  // selections, forwarded to MemoryGraph's `bankFilter` / `typeFilter`.
  const [graphTypes, setGraphTypes] = useState<string[]>([]);
  const [graphBanks, setGraphBanks] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [graphColumnFilters, setGraphColumnFilters] =
    useState<ColumnFiltersState>([]);
  const graphFacetColumns: DataTableTokenFilterColumn[] = useMemo(
    () => [
      {
        id: "bank",
        label: "Bank",
        type: "option",
        icon: <Database className="size-4" />,
        options: graphBanks.map((b) => ({ value: b.id, label: b.name })),
      },
      {
        id: "entityType",
        label: "Type",
        type: "option",
        icon: <Shapes className="size-4" />,
        options: graphTypes.map((value) => ({ value, label: value })),
      },
    ],
    [graphBanks, graphTypes],
  );
  const graphFilterColumns: ColumnDef<{ bank: string; entityType: string }>[] =
    useMemo(
      () => [
        {
          id: "bank",
          accessorFn: (row) => row.bank,
          filterFn: dataTableTokenFilterFns.option,
        },
        {
          id: "entityType",
          accessorFn: (row) => row.entityType,
          filterFn: dataTableTokenFilterFns.option,
        },
      ],
      [],
    );
  const graphFilterTable = useReactTable({
    data: [] as { bank: string; entityType: string }[],
    columns: graphFilterColumns,
    state: { columnFilters: graphColumnFilters },
    onColumnFiltersChange: setGraphColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const selectedColumnValues = useCallback(
    (id: string) => {
      const raw = graphColumnFilters.find((c) => c.id === id)?.value as
        | { value?: unknown }
        | undefined;
      const v = raw?.value;
      const arr = Array.isArray(v) ? v : v != null ? [v] : [];
      return arr.filter((x): x is string => typeof x === "string");
    },
    [graphColumnFilters],
  );
  const selectedEntityTypes = useMemo(
    () => selectedColumnValues("entityType"),
    [selectedColumnValues],
  );
  const selectedBanks = useMemo(
    () => selectedColumnValues("bank"),
    [selectedColumnValues],
  );

  const isLoading = recordsResult.fetching && !recordsResult.data;
  const isRefreshing =
    (recordsResult.fetching && Boolean(recordsResult.data)) ||
    retainAttemptsResult.fetching;
  const retainAttention = useMemo(() => {
    const attempts = retainAttemptsResult.data?.memoryRetainAttempts ?? [];
    let retrying = 0;
    let deadLettered = 0;
    for (const attempt of attempts) {
      const status = attempt.status ?? "";
      if (status === "dead_lettered") deadLettered += 1;
      if (status === "failed_timeout" || status === "failed_backend") {
        retrying += 1;
      }
    }
    return { retrying, deadLettered, total: retrying + deadLettered };
  }, [retainAttemptsResult.data]);

  const refreshMemory = useCallback(async () => {
    if (!effectiveTenantId) return;
    reexecuteSpacesQuery({ requestPolicy: "network-only" });
    reexecuteMembersQuery({ requestPolicy: "network-only" });
    reexecuteRecordsQuery({ requestPolicy: "network-only" });
    reexecuteRetainAttemptsQuery({ requestPolicy: "network-only" });
  }, [
    effectiveTenantId,
    reexecuteMembersQuery,
    reexecuteRecordsQuery,
    reexecuteRetainAttemptsQuery,
    reexecuteSpacesQuery,
  ]);

  useEffect(() => {
    if (!onRefreshControllerChange) return;
    onRefreshControllerChange({
      refresh: refreshMemory,
      isRefreshing,
      disabled: !effectiveTenantId,
    });
    return () => onRefreshControllerChange(null);
  }, [
    effectiveTenantId,
    isRefreshing,
    onRefreshControllerChange,
    refreshMemory,
  ]);

  // THINK-199: publish raw-units state so the toggle renders in the page
  // header (next to refresh). Hidden while searching or in graph view — the
  // filter only applies to the default table listing.
  const rawToggleVisible =
    view === "table" && !activeSearch && rawHiddenCount > 0;
  useEffect(() => {
    if (!onRawUnitsControllerChange) return;
    onRawUnitsControllerChange(
      rawToggleVisible
        ? {
            showRaw,
            hiddenCount: rawHiddenCount,
            toggle: () => setShowRaw((v) => !v),
          }
        : null,
    );
    return () => onRawUnitsControllerChange(null);
  }, [rawToggleVisible, showRaw, rawHiddenCount, onRawUnitsControllerChange]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {embedded ? null : <MemoryHeader />}
      <SettingsPageTitle
        title="Memory"
        description="Inspect and manage what your agents remember across threads."
        badge={
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as MemoryView)}
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
        <MemoryToolbarSearch
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onCommitSearch={setActiveSearch}
        />
        {view === "graph" ? (
          <DataTableTokenFilter
            table={graphFilterTable}
            columns={graphFacetColumns}
            addLabel="Filter"
            showAddLabel={false}
            clearLabel="Clear filters"
            flattenToolbar
            className="max-w-full [&_[data-token-filter-token]]:shrink-0"
            popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
          />
        ) : (
          <DataTableTokenFilter
            table={tableFilterTable}
            columns={tableFacetColumns}
            addLabel="Filter"
            showAddLabel={false}
            clearLabel="Clear filters"
            flattenToolbar
            className="max-w-full [&_[data-token-filter-token]]:shrink-0"
            popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
          />
        )}
      </div>
      {retainAttention.total > 0 ? (
        <div
          role="status"
          className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          Memory retain status: {retainAttention.retrying} retrying
          {retainAttention.deadLettered > 0
            ? `, ${retainAttention.deadLettered} dead-lettered`
            : ""}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {view === "graph" ? (
          <div className="relative h-full overflow-hidden rounded-lg border border-border">
            {effectiveTenantId ? (
              <MemoryGraph
                loadingFallback={
                  <div className="flex h-full min-h-48 items-center justify-center">
                    <LoadingShimmer />
                  </div>
                }
                ref={graphRef}
                useRequesterScope
                allTenantBanks
                searchQuery={searchQuery || undefined}
                onTypesLoaded={setGraphTypes}
                onBanksLoaded={setGraphBanks}
                typeFilter={
                  selectedEntityTypes.length ? selectedEntityTypes : undefined
                }
                bankFilter={selectedBanks.length ? selectedBanks : undefined}
                onNodeClick={(node, edges) => {
                  setGraphNode(node);
                  setGraphNodeEdges(edges);
                  setGraphNodeHistory([]);
                  setGraphSheetOpen(true);
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <LoadingShimmer />
              </div>
            )}
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : rows.length === 0 ? (
          rawHiddenCount > 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="max-w-xl px-6 text-center text-sm text-muted-foreground">
                No curated memories yet — {rawHiddenCount} raw unit
                {rawHiddenCount === 1 ? "" : "s"} hidden. Use “Show raw units”
                to see them.
              </p>
            </div>
          ) : (
            <MemoryEmptyState activeSearch={activeSearch} />
          )
        ) : (
          <DataTable
            columns={columns}
            data={filteredRows}
            emptyState={
              <div className="py-10 text-center text-sm text-muted-foreground">
                No memories match the current filters.
              </div>
            }
            onRowClick={(row) => {
              setSelectedRecord(row);
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
        {selectedRecord && (
          <MemoryDetailSheet record={selectedRecord} canForget={false} />
        )}
      </Sheet>

      <Sheet open={graphSheetOpen} onOpenChange={setGraphSheetOpen}>
        {graphNode && (
          <MemoryGraphNodeSheet
            node={graphNode}
            edges={graphNodeEdges}
            tenantId={effectiveTenantId}
            userId={requesterUserId}
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
              const result = graphRef.current?.getNodeWithEdges(edge.targetId);
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
      </Sheet>
    </div>
  );
}

function formatBankLabel(
  row: MemoryRow,
  ownerLabels: Map<string, string>,
): string {
  const ownerLabel = formatOwnerName(row, ownerLabels);
  if (ownerLabel) return ownerLabel;
  return compactMemoryId(row.bankId ?? row.namespace ?? "-");
}

function formatOwnerScope(
  row: MemoryRow,
  ownerLabels: Map<string, string>,
): string {
  const type = row.ownerType ?? "unknown";
  const ownerLabel = formatOwnerName(row, ownerLabels);
  if (ownerLabel) return `${formatOwnerType(type)}: ${ownerLabel}`;
  const id = row.ownerId ? compactMemoryId(row.ownerId) : "";
  return id ? `${formatOwnerType(type)}: ${id}` : formatOwnerType(type);
}

function formatOwnerName(
  row: MemoryRow,
  ownerLabels: Map<string, string>,
): string | null {
  if (!row.ownerType || !row.ownerId) return null;
  return ownerLabels.get(`${row.ownerType}:${row.ownerId}`) ?? null;
}

function formatOwnerType(value: string): string {
  if (value === "user") return "User";
  if (value === "space") return "Space";
  if (value === "agent") return "Agent";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function compactMemoryId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 14)}...`;
}

function MemoryEmptyState({ activeSearch }: { activeSearch: string }) {
  const title = activeSearch
    ? "No matching memory rows"
    : "No memory rows found";

  const detail = activeSearch
    ? "The operator memory query returned 0 User or Space memory rows for this search."
    : "This tenant does not have User, Space, or agent memory rows yet.";

  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xl px-6 text-center">
        <Search className="mx-auto h-11 w-11 text-muted-foreground/40" />
        <h3 className="mt-4 text-base font-medium text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
