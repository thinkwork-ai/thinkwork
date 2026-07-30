import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
import {
  Brain,
  Layers,
  RefreshCw,
  ScrollText,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
  TooltipIconButton,
  cn,
  isDataTableTokenFilterValue,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";
import {
  ComputerMemoryEpisodicRecordsQuery,
  ComputerMemoryRecordsQuery,
  ComputerMemoryRetainAttemptsQuery,
  ComputerMemorySearchQuery,
  DeleteComputerMemoryRecordMutation,
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
import {
  MemoryDetailSheet,
  type MemoryRow,
} from "@/components/memory/MemoryDetailSheet";

const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

/** Own-user scope sentinel — the resolvers fall back to the caller. */
const SCOPE_SELF = "__self__";

/**
 * The AgentCore memory facets, in extraction order. These mirror the strategy
 * namespaces provisioned for the managed memory resource:
 *
 *   semantic     -> assistant_{actorId}   (+ user_{actorId} from `remember`)
 *   preferences  -> preferences_{actorId}
 *   summaries    -> session_{sessionId}
 *   episodes     -> episodes_{actorId}/{sessionId}
 *   reflections  -> episodes_{actorId}/
 */
// Summaries deliberately has no chip: they land in session_{sessionId}
// namespaces (no actor segment), so there is no per-user read path under
// AgentCore. Records that do surface with a summaries strategy still get
// their badge; only the dead filter chip is omitted.
const FACETS = [
  { value: "semantic", label: "Semantic" },
  { value: "preferences", label: "Preferences" },
  { value: "episodes", label: "Episodes" },
  { value: "reflections", label: "Reflections" },
] as const;

/** Filter-table column ids for the toolbar (same shape as WorkflowInventory). */
const MEMORY_FILTER_COLUMNS = {
  bank: "memoryBank",
  type: "memoryType",
} as const;

function StrategyBadge({ strategy }: { strategy: string | null }) {
  if (!strategy) return null;
  const colors = STRATEGY_COLORS[strategy] || "bg-muted text-muted-foreground";
  return (
    <Badge className={`${colors} whitespace-nowrap font-normal text-xs`}>
      {strategyLabel(strategy)}
    </Badge>
  );
}

function mapRecord(r: any): MemoryRow {
  return {
    memoryRecordId: r.memoryRecordId,
    text: r.content?.text ?? "",
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
    namespace: r.namespace ?? null,
    bankId: r.bankId ?? null,
    ownerType: r.ownerType ?? null,
    ownerId: r.ownerId ?? null,
    strategy:
      r.strategy ?? inferStrategy(r.strategyId ?? "", r.namespace ?? ""),
    score: typeof r.score === "number" ? r.score : null,
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
  };
}

function dedupeById(rows: MemoryRow[]): MemoryRow[] {
  const byId = new Map<string, MemoryRow>();
  for (const row of rows) {
    if (!byId.has(row.memoryRecordId)) byId.set(row.memoryRecordId, row);
  }
  return [...byId.values()];
}

/**
 * The Memory settings page (THINK-405). One page, no tabs: a semantic search
 * bar, the AgentCore strategy facets, the record table, and a detail sheet.
 *
 * Records are stored in per-actor namespaces, so everything here is scoped to
 * one user — the signed-in operator by default, any tenant member via the
 * scope picker (`requireMemoryUserScope(..., allowTenantAdmin)` on the
 * resolver side).
 *
 * There is deliberately no edit action. AgentCore's BatchUpdateMemoryRecords
 * reports SUCCEEDED for extracted records and then silently keeps the original
 * text, so the adapter's `update()` throws rather than lie; delete (`forget`)
 * is the only real write. See
 * packages/api/src/lib/memory/adapters/agentcore-adapter.ts.
 */
export function SettingsMemory() {
  const { tenantId, userId: callerUserId } = useTenant();
  const effectiveTenantId = tenantId ?? null;

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<MemoryRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The Memory-bank token drives the server queries (records live in
  // per-actor namespaces), so it never filters rows client-side — its filter
  // value is read back out of the table state here.
  const scopedUserId = useMemo(() => {
    const filter = columnFilters.find(
      (f) => f.id === MEMORY_FILTER_COLUMNS.bank,
    )?.value;
    if (!isDataTableTokenFilterValue(filter)) return null;
    const first = Array.isArray(filter.value) ? filter.value[0] : filter.value;
    return typeof first === "string" && first && first !== SCOPE_SELF
      ? first
      : null;
  }, [columnFilters]);

  const selectedTypes = useMemo(() => {
    const filter = columnFilters.find(
      (f) => f.id === MEMORY_FILTER_COLUMNS.type,
    )?.value;
    if (!isDataTableTokenFilterValue(filter)) return [] as string[];
    if (filter.operator !== "is" && filter.operator !== "is_any_of") return [];
    return (Array.isArray(filter.value) ? filter.value : [filter.value]).filter(
      (v): v is string => typeof v === "string",
    );
  }, [columnFilters]);

  const [membersResult, reexecuteMembers] = useQuery<{
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

  const [recordsResult, reexecuteRecords] = useQuery<{
    memoryRecords?: any[] | null;
  }>({
    query: ComputerMemoryRecordsQuery,
    variables: {
      tenantId: effectiveTenantId,
      userId: scopedUserId,
      namespace: "requester",
      limit: 500,
    },
    pause: !effectiveTenantId,
  });

  const [episodicResult, reexecuteEpisodic] = useQuery<{
    memoryEpisodicRecords?: any[] | null;
  }>({
    query: ComputerMemoryEpisodicRecordsQuery,
    variables: {
      tenantId: effectiveTenantId,
      userId: scopedUserId,
      limit: 200,
    },
    pause: !effectiveTenantId,
  });

  const [searchResult] = useQuery<{
    memorySearch?: { records?: any[] | null } | null;
  }>({
    query: ComputerMemorySearchQuery,
    variables: {
      tenantId: effectiveTenantId,
      userId: scopedUserId,
      query: activeSearch,
      strategy:
        selectedTypes.length === 1 ? selectedTypes[0].toUpperCase() : null,
      limit: 50,
    },
    pause: !effectiveTenantId || !activeSearch,
  });

  const [retainResult, reexecuteRetain] = useQuery<{
    memoryRetainAttempts?: Array<{
      id: string;
      status?: string | null;
      attemptCount?: number | null;
      maxAttempts?: number | null;
      errorClass?: string | null;
      errorMessage?: string | null;
      createdAt?: string | null;
    }> | null;
  }>({
    query: ComputerMemoryRetainAttemptsQuery,
    variables: { tenantId: effectiveTenantId ?? "", limit: 25 },
    pause: !effectiveTenantId,
  });

  const [, deleteMemoryRecord] = useMutation(
    DeleteComputerMemoryRecordMutation,
  );

  const searching = Boolean(activeSearch);

  // The browse listing is the union of the actor-scoped namespaces
  // (memoryRecords) and the session-scoped episodic ones — two reads because
  // the engine can't list them together without swamping cross-thread recall.
  const browseRows = useMemo(
    () =>
      dedupeById([
        ...(recordsResult.data?.memoryRecords ?? []).map(mapRecord),
        ...(episodicResult.data?.memoryEpisodicRecords ?? []).map(mapRecord),
      ]).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [recordsResult.data, episodicResult.data],
  );

  const searchRows = useMemo(
    () =>
      dedupeById(
        (searchResult.data?.memorySearch?.records ?? []).map(mapRecord),
      ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [searchResult.data],
  );

  const sourceRows = searching ? searchRows : browseRows;

  const filterColumns = useMemo<ColumnDef<MemoryRow>[]>(
    () => [
      {
        id: MEMORY_FILTER_COLUMNS.type,
        accessorFn: (row: MemoryRow) => row.strategy ?? "semantic",
        filterFn: dataTableTokenFilterFns.option,
      },
      {
        // Query-scope only — never filters rows (see scopedUserId above).
        id: MEMORY_FILTER_COLUMNS.bank,
        accessorFn: () => SCOPE_SELF,
        filterFn: () => true,
      },
    ],
    [],
  );
  const filterTable = useReactTable({
    data: sourceRows,
    columns: filterColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const rows = useMemo(
    () => filterTable.getFilteredRowModel().rows.map((row) => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterTable.getState().columnFilters, sourceRows],
  );

  const memberOptions = useMemo(() => {
    const options: Array<{ id: string; label: string }> = [];
    for (const member of membersResult.data?.tenantMembers ?? []) {
      if (member.principalType?.toUpperCase() !== "USER") continue;
      const user = member.user;
      const id = user?.id || member.principalId;
      if (!id || id === callerUserId) continue;
      const label =
        user?.profile?.callBy || user?.name || user?.email || `User ${id}`;
      options.push({ id, label });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [membersResult.data, callerUserId]);

  const tokenFilterColumns = useMemo<DataTableTokenFilterColumn[]>(
    () => [
      {
        id: MEMORY_FILTER_COLUMNS.bank,
        label: "Memory bank",
        type: "option",
        singleSelect: true,
        icon: <UserRound className="size-4" />,
        options: [
          { value: SCOPE_SELF, label: "My memory" },
          ...memberOptions.map((option) => ({
            value: option.id,
            label: option.label,
          })),
        ],
        emptyMessage: "No members",
      },
      {
        id: MEMORY_FILTER_COLUMNS.type,
        label: "Memory type",
        type: "option",
        icon: <Layers className="size-4" />,
        options: FACETS.map((f) => ({ value: f.value, label: f.label })),
      },
    ],
    [memberOptions],
  );

  const isLoading =
    (recordsResult.fetching && !recordsResult.data) ||
    (searching && searchResult.fetching && !searchResult.data);
  const isRefreshing =
    (recordsResult.fetching && Boolean(recordsResult.data)) ||
    episodicResult.fetching ||
    retainResult.fetching;

  const refresh = useCallback(() => {
    if (!effectiveTenantId) return;
    reexecuteMembers({ requestPolicy: "network-only" });
    reexecuteRecords({ requestPolicy: "network-only" });
    reexecuteEpisodic({ requestPolicy: "network-only" });
    reexecuteRetain({ requestPolicy: "network-only" });
  }, [
    effectiveTenantId,
    reexecuteEpisodic,
    reexecuteMembers,
    reexecuteRecords,
    reexecuteRetain,
  ]);

  const retainAttention = useMemo(() => {
    const attempts = retainResult.data?.memoryRetainAttempts ?? [];
    let retrying = 0;
    let deadLettered = 0;
    for (const attempt of attempts) {
      if (attempt.status === "dead_lettered") deadLettered += 1;
      if (
        attempt.status === "failed_timeout" ||
        attempt.status === "failed_backend"
      ) {
        retrying += 1;
      }
    }
    return { retrying, deadLettered, attempts };
  }, [retainResult.data]);
  const retainUnhealthy =
    retainAttention.retrying + retainAttention.deadLettered > 0;

  usePageHeaderActions({
    title: "Memory",
    breadcrumbs: [{ label: "Memory" }],
    action: (
      <>
        <TooltipIconButton
          label={
            retainUnhealthy
              ? `Retain ledger — ${retainAttention.retrying} retrying, ${retainAttention.deadLettered} dead-lettered`
              : "Retain ledger"
          }
          className={cn(retainUnhealthy && "text-destructive")}
          onClick={() => setLedgerOpen(true)}
        >
          <ScrollText className="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          label="Refresh memory records"
          className={cn(
            isRefreshing && "bg-primary/10 text-primary hover:text-primary",
          )}
          disabled={!effectiveTenantId}
          onClick={refresh}
        >
          <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
        </TooltipIconButton>
      </>
    ),
    actionKey: `memory-refresh:${effectiveTenantId ? "enabled" : "disabled"}:${
      isRefreshing ? "refreshing" : "idle"
    }:${retainUnhealthy ? "attention" : "healthy"}`,
  });

  const columns: ColumnDef<MemoryRow>[] = useMemo(() => {
    const base: ColumnDef<MemoryRow>[] = [
      {
        accessorKey: "createdAt",
        header: "Date",
        size: 120,
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
        accessorKey: "strategy",
        // Wide enough for the longest label ("Preferences"/"Reflections") so
        // the badge never clips under table-fixed.
        header: "Type",
        size: 124,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <StrategyBadge strategy={row.original.strategy} />
          </span>
        ),
      },
      {
        accessorKey: "namespace",
        header: "Namespace",
        size: 200,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {row.original.namespace ?? "—"}
            </span>
          </span>
        ),
      },
      {
        // No explicit size: flexes into the remaining width under table-fixed
        // while the content truncates onto one line.
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
    ];
    if (!searching) return base;
    return [
      ...base,
      {
        accessorKey: "score",
        header: "Score",
        size: 80,
        cell: ({ row }) => (
          <span
            className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
          >
            {row.original.score != null ? row.original.score.toFixed(3) : "—"}
          </span>
        ),
      },
    ];
  }, [searching]);

  const submitSearch = useCallback(() => {
    setActiveSearch(searchInput.trim());
  }, [searchInput]);

  const clearSearch = useCallback(() => {
    setSearchInput("");
    setActiveSearch("");
  }, []);

  const handleForget = useCallback(async () => {
    if (!selectedRecord || !effectiveTenantId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteMemoryRecord({
        tenantId: effectiveTenantId,
        userId: scopedUserId,
        memoryRecordId: selectedRecord.memoryRecordId,
      });
      if (result.error) throw result.error;
      setSheetOpen(false);
      setSelectedRecord(null);
      refresh();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete memory record",
      );
    } finally {
      setDeleting(false);
    }
  }, [
    deleteMemoryRecord,
    effectiveTenantId,
    refresh,
    scopedUserId,
    selectedRecord,
  ]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Memory"
        description="Inspect and manage what your agents remember across threads."
      />

      {/* Toolbar copied from the Workflows inventory: a collapsed icon
          search plus the token filter (icon-only Add button, removable
          tokens). */}
      <div className="mb-3 flex shrink-0 items-center pt-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <MemoryToolbarSearch
            value={searchInput}
            onChange={setSearchInput}
            onSubmit={submitSearch}
            onClear={clearSearch}
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
      </div>

      {deleteError ? (
        <div
          role="alert"
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {deleteError}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            onRowClick={(row) => {
              setSelectedRecord(row);
              setDeleteError(null);
              setSheetOpen(true);
            }}
            scrollable
            allowHorizontalScroll={false}
            pageSize={25}
            tableClassName="table-fixed"
            emptyStatePlacement="container"
            emptyState={
              <MemoryEmptyState
                searching={searching}
                filtered={selectedTypes.length > 0}
              />
            }
          />
        )}
      </div>

      <Sheet open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <SheetContent className="flex flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Retain ledger</SheetTitle>
            <SheetDescription>
              {retainUnhealthy
                ? `${retainAttention.retrying} retrying, ${retainAttention.deadLettered} dead-lettered`
                : "Healthy — recent retain attempts for this tenant."}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {retainAttention.attempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No retain attempts recorded for this tenant.
              </p>
            ) : (
              <ul className="space-y-2">
                {retainAttention.attempts.map((attempt) => (
                  <li
                    key={attempt.id}
                    className="rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{attempt.status}</span>
                      <span className="text-muted-foreground">
                        {attempt.attemptCount ?? 0}/{attempt.maxAttempts ?? 0}
                      </span>
                    </div>
                    {attempt.errorClass ? (
                      <div className="mt-1 truncate text-muted-foreground">
                        {attempt.errorClass}
                        {attempt.errorMessage ? ` · ${attempt.errorMessage}` : ""}
                      </div>
                    ) : null}
                    {attempt.createdAt ? (
                      <div className="mt-1 text-muted-foreground">
                        {new Date(attempt.createdAt).toLocaleString()}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        {selectedRecord && (
          <MemoryDetailSheet
            record={selectedRecord}
            deleting={deleting}
            onForget={handleForget}
          />
        )}
      </Sheet>
    </div>
  );
}

/**
 * The WorkflowToolbarSearch chrome (collapsed icon that expands into a
 * borderless input), with submit-on-Enter semantics because memory search is
 * a server-side semantic query, not a client text filter.
 */
function MemoryToolbarSearch({
  value,
  onChange,
  onSubmit,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || value.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-8 w-8 rounded-md"
        aria-label="Search memory"
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <form
      className="relative flex h-8 w-[min(16rem,calc(100vw-2rem))] items-center"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search memory"
        placeholder="Search memory and press Enter..."
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={value}
        onBlur={() => {
          if (!value) setExpanded(false);
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClear();
            setExpanded(false);
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Clear search"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onClear();
          setExpanded(false);
        }}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </form>
  );
}

function MemoryEmptyState({
  searching,
  filtered,
}: {
  searching: boolean;
  filtered: boolean;
}) {
  const detail = searching
    ? "The semantic search returned no records for this scope and filters."
    : filtered
      ? "No records match the current filters for this user."
      : "No memories yet — nothing has been remembered for this user. Memory is extracted in the background after threads run.";

  // Rendered centered inside the DataTable body (headers + pagination stay
  // visible), matching the empty look of the other settings tables.
  return (
    <div className="px-6 text-center">
      <Brain className="mx-auto h-9 w-9 text-muted-foreground/40" />
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}
