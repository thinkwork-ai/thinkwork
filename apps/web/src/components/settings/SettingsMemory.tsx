import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { RefreshCw, Search, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  TooltipIconButton,
  cn,
} from "@thinkwork/ui";
import {
  ComputerMemoryEpisodicRecordsQuery,
  ComputerMemoryRecordsQuery,
  ComputerMemoryRetainAttemptsQuery,
  ComputerMemorySearchQuery,
  ComputerMemorySystemConfigQuery,
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
  { value: "all", label: "All" },
  { value: "semantic", label: "Semantic" },
  { value: "preferences", label: "Preferences" },
  { value: "episodes", label: "Episodes" },
  { value: "reflections", label: "Reflections" },
] as const;

type Facet = (typeof FACETS)[number]["value"];

function engineLabel(activeEngine: string | null | undefined): string {
  if (activeEngine === "agentcore") return "AgentCore managed memory";
  if (activeEngine === "hindsight") return "Hindsight";
  if (!activeEngine || activeEngine === "unavailable") {
    return "No memory engine configured";
  }
  return activeEngine;
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

  const [facet, setFacet] = useState<Facet>("all");
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [scopeUserId, setScopeUserId] = useState<string>(SCOPE_SELF);
  const [selectedRecord, setSelectedRecord] = useState<MemoryRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const scopedUserId = scopeUserId === SCOPE_SELF ? null : scopeUserId;

  const [configResult] = useQuery<{
    memorySystemConfig?: {
      activeEngine?: string | null;
      managedMemoryEnabled?: boolean | null;
    } | null;
  }>({ query: ComputerMemorySystemConfigQuery });

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
      strategy: facet === "all" ? null : facet.toUpperCase(),
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

  // Counts always come from the browse listing so the chips stay a stable map
  // of what exists, not of what the current search happened to return.
  const facetCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of browseRows) {
      const key = row.strategy ?? "semantic";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [browseRows]);

  const rows = useMemo(
    () =>
      facet === "all"
        ? sourceRows
        : sourceRows.filter((r) => r.strategy === facet),
    [sourceRows, facet],
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

  usePageHeaderActions({
    title: "Memory",
    breadcrumbs: [{ label: "Memory" }],
    action: (
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
    ),
    actionKey: `memory-refresh:${effectiveTenantId ? "enabled" : "disabled"}:${
      isRefreshing ? "refreshing" : "idle"
    }`,
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
        header: "Facet",
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

  const activeEngine = configResult.data?.memorySystemConfig?.activeEngine;
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Memory"
        description="Inspect and manage what your agents remember across threads."
      />

      <p
        className="mb-3 shrink-0 text-xs text-muted-foreground"
        data-testid="memory-engine-banner"
      >
        Active engine: {engineLabel(activeEngine)}
      </p>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <form
          className="relative flex h-8 w-[min(22rem,100%)] items-center"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search memory"
            placeholder="Search memory and press Enter..."
            className="h-8 rounded-md pl-8 pr-8 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              onClick={clearSearch}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </form>

        <Select value={scopeUserId} onValueChange={setScopeUserId}>
          <SelectTrigger className="h-8 w-56" aria-label="Memory scope">
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SCOPE_SELF}>My memory</SelectItem>
            {memberOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Memory facets"
      >
        {FACETS.map((f) => {
          const active = facet === f.value;
          const colors =
            f.value === "all"
              ? "bg-muted text-muted-foreground"
              : (STRATEGY_COLORS[f.value] ?? "bg-muted text-muted-foreground");
          const count =
            f.value === "all" ? browseRows.length : (facetCounts[f.value] ?? 0);
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={active}
              data-testid={`memory-facet-${f.value}`}
              onClick={() => setFacet(f.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-normal transition-opacity",
                colors,
                active
                  ? "ring-2 ring-primary/60"
                  : "opacity-60 hover:opacity-100",
              )}
            >
              {f.label}
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
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
        ) : rows.length === 0 ? (
          <MemoryEmptyState searching={searching} facet={facet} />
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
          />
        )}
      </div>

      <details className="mt-4 shrink-0 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">
          Retain ledger
          {retainAttention.retrying + retainAttention.deadLettered > 0
            ? ` — ${retainAttention.retrying} retrying, ${retainAttention.deadLettered} dead-lettered`
            : " — healthy"}
        </summary>
        <ul className="mt-2 space-y-1">
          {retainAttention.attempts.length === 0 ? (
            <li>No retain attempts recorded for this tenant.</li>
          ) : (
            retainAttention.attempts.slice(0, 10).map((attempt) => (
              <li key={attempt.id} className="truncate">
                <span className="font-mono">{attempt.status}</span>{" "}
                {attempt.attemptCount ?? 0}/{attempt.maxAttempts ?? 0}
                {attempt.errorClass ? ` · ${attempt.errorClass}` : ""}
              </li>
            ))
          )}
        </ul>
      </details>

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

function MemoryEmptyState({
  searching,
  facet,
}: {
  searching: boolean;
  facet: Facet;
}) {
  const title = searching ? "No matching memories" : "No memories yet";
  const detail = searching
    ? "The semantic search returned no records for this scope and facet."
    : facet === "all"
      ? "Nothing has been remembered for this user yet. Memory is extracted in the background after threads run."
      : `No ${strategyLabel(facet).toLowerCase()} records for this user yet.`;

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
