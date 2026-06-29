import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "urql";
import { Brain, Search, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  DataTable,
  Input,
  Sheet,
  ToggleGroup,
  ToggleGroupItem,
} from "@thinkwork/ui";
import {
  MemoryGraph,
  type MemoryGraphHandle,
  type MemoryGraphNode,
} from "@thinkwork/graph";
import {
  ComputerMemoryRecordsQuery,
  ComputerMemoryRetainAttemptsQuery,
  ComputerMemorySystemConfigQuery,
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
import {
  MemoryDetailSheet,
  type MemoryRow,
} from "@/components/memory/MemoryDetailSheet";
import {
  MemoryGraphNodeSheet,
  type MemoryGraphEdge,
} from "@/components/memory/MemoryGraphNodeSheet";

type BrainView = "table" | "graph";
const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

type MemorySystemConfig = {
  activeEngine?: string | null;
  managedMemoryEnabled?: boolean | null;
  hindsightEnabled?: boolean | null;
  cogneeMemoryEnabled?: boolean | null;
  userMemoryEnabled?: boolean | null;
  spaceMemoryEnabled?: boolean | null;
  legacyHindsightAvailable?: boolean | null;
  companyDistillationEnabled?: boolean | null;
  wikiProjectionEnabled?: boolean | null;
};

export interface MemoryRefreshController {
  refresh: () => Promise<void>;
  isRefreshing: boolean;
  disabled: boolean;
}

// Null-rendering header publisher (see SettingsContent's TablePaneHeader). Kept
// as a child so the embedded variant can suppress it without a conditional hook.
function MemoryHeader() {
  usePageHeaderActions({ title: "Memory", breadcrumbs: [{ label: "Memory" }] });
  return null;
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
}: {
  embedded?: boolean;
  onRefreshControllerChange?: (
    controller: MemoryRefreshController | null,
  ) => void;
} = {}) {
  const { tenantId } = useTenant();
  const [view, setView] = useState<BrainView>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<MemoryGraphHandle>(null);

  const effectiveTenantId = tenantId ?? null;
  const requesterUserId = null;
  const namespace = "requester";

  const [systemResult, reexecuteSystemQuery] = useQuery<{
    memorySystemConfig?: MemorySystemConfig | null;
  }>({
    query: ComputerMemorySystemConfigQuery,
  });

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

  const rows: MemoryRow[] = useMemo(
    () =>
      rawRecords
        .map(mapRecord)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [rawRecords, mapRecord],
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
    reexecuteSystemQuery({ requestPolicy: "network-only" });
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
    reexecuteSystemQuery,
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {embedded ? null : <MemoryHeader />}
      <SettingsPageTitle
        title="Memory"
        description="Inspect and manage what your agents remember across threads."
      />
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <div className="relative w-fit min-w-56 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search Hindsight records..."
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
          onValueChange={(v) => v && setView(v as BrainView)}
          variant="outline"
        >
          <ToggleGroupItem value="table" className="px-3 text-xs">
            Table
          </ToggleGroupItem>
          <ToggleGroupItem value="graph" className="px-3 text-xs">
            Graph
          </ToggleGroupItem>
        </ToggleGroup>
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
                ref={graphRef}
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
          <MemoryEmptyState
            activeSearch={activeSearch}
            config={systemResult.data?.memorySystemConfig}
          />
        ) : (
          <DataTable
            columns={columns}
            data={rows}
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

function MemoryEmptyState({
  activeSearch,
  config,
}: {
  activeSearch: string;
  config?: MemorySystemConfig | null;
}) {
  const hindsightActive = config?.hindsightEnabled === true;
  const hindsightAvailableButInactive =
    !hindsightActive && config?.legacyHindsightAvailable === true;

  const title = activeSearch
    ? "No matching memory rows"
    : hindsightAvailableButInactive
      ? "Memory service update required"
      : "No memory rows found";

  const detail = activeSearch
    ? "The operator memory query returned 0 Hindsight rows for this search."
    : hindsightAvailableButInactive
      ? "The table reads Hindsight banks, but this deployment has not switched to Hindsight yet. Redeploy with MEMORY_ENGINE=hindsight and retain user or Space memory to populate rows."
      : "The operator memory query returned 0 Hindsight memory_units across user, Space, and agent banks for this tenant.";

  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xl px-6 text-center">
        <Brain className="mx-auto h-11 w-11 text-muted-foreground/40" />
        <h3 className="mt-4 text-base font-medium text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
