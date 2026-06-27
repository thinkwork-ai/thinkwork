import { useCallback, useMemo, useRef, useState } from "react";
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
  ComputerMemorySystemConfigQuery,
} from "@/lib/graphql-queries";
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

export function SettingsMemory({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useTenant();
  const [view, setView] = useState<BrainView>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<MemoryGraphHandle>(null);

  const effectiveTenantId = tenantId ?? null;
  const requesterUserId = null;
  const namespace = "requester";

  const [systemResult] = useQuery<{
    memorySystemConfig?: MemorySystemConfig | null;
  }>({
    query: ComputerMemorySystemConfigQuery,
  });

  const [recordsResult] = useQuery<{
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

  const columns: ColumnDef<MemoryRow>[] = useMemo(
    () => [
      {
        accessorKey: "createdAt",
        header: "Date",
        size: 140,
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
        accessorKey: "updatedAt",
        header: "Updated",
        size: 140,
        cell: ({ row }) => (
          <span
            className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
          >
            {formatShortDate(row.original.updatedAt)}
          </span>
        ),
      },
      {
        accessorKey: "bankId",
        header: "Bank",
        size: 180,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <span className="truncate font-mono text-xs">
              {row.original.bankId ?? row.original.namespace ?? "-"}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "ownerType",
        header: "Scope",
        size: 140,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <span className="truncate text-xs">
              {formatOwnerScope(row.original)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "factType",
        // Wide enough for the longest strategy label ("Reflections" /
        // "Preferences") so the badge never clips under table-fixed.
        header: "Type",
        size: 132,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <StrategyBadge strategy={row.original.strategy} />
          </span>
        ),
      },
      {
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
    [],
  );

  const isLoading = recordsResult.fetching && !recordsResult.data;

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {embedded ? null : <MemoryHeader />}
      <SettingsPageTitle
        title="Memory"
        description="Inspect and manage what your agents remember across threads."
      />
      <MemoryModeStatus config={systemResult.data?.memorySystemConfig} />
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
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {activeSearch
                ? "No operator-visible Hindsight records match your search."
                : "No Hindsight records were returned for this tenant."}
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            onRowClick={(row) => {
              setSelectedRecord(row);
              setSheetOpen(true);
            }}
            scrollable
            allowHorizontalScroll
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

function formatShortDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatOwnerScope(row: MemoryRow): string {
  const type = row.ownerType ?? "unknown";
  const id = row.ownerId ?? "";
  return id ? `${type}:${id}` : type;
}

function MemoryModeStatus({ config }: { config?: MemorySystemConfig | null }) {
  const activeEngine = config?.activeEngine ?? "unknown";
  const cogneeActive = config?.cogneeMemoryEnabled === true;
  const hindsightActive = config?.hindsightEnabled === true;

  return (
    <div className="mb-4 border-y border-border bg-muted/30 px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {cogneeActive
                ? "ThinkWork Brain diagnostic"
                : hindsightActive
                  ? "Hindsight memory"
                  : `${activeEngine} memory`}
            </Badge>
            <Badge
              variant="outline"
              className={
                config?.userMemoryEnabled
                  ? "border-emerald-500/40 text-emerald-700"
                  : "text-muted-foreground"
              }
            >
              User memory
            </Badge>
            <Badge
              variant="outline"
              className={
                config?.spaceMemoryEnabled
                  ? "border-emerald-500/40 text-emerald-700"
                  : "text-muted-foreground"
              }
            >
              Space memory
            </Badge>
            {config?.legacyHindsightAvailable ? (
              <Badge variant="outline" className="text-muted-foreground">
                Legacy Hindsight banks available
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {cogneeActive
              ? "ThinkWork Brain graph infrastructure is present for operator diagnostics. Hindsight-backed ThinkWork memory remains the user and Space memory product path for this pass."
              : hindsightActive
                ? "Hindsight is the active core memory engine for this deployment. User memory follows the requester; Space memory belongs to the current Space."
                : "Memory status is reported by the selected deployment engine."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-muted-foreground">
            Company distillation{" "}
            {config?.companyDistillationEnabled ? "enabled" : "deferred"}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            Wiki projection{" "}
            {config?.wikiProjectionEnabled ? "enabled" : "deferred"}
          </Badge>
        </div>
      </div>
    </div>
  );
}
