import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
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
  ComputerMemorySearchQuery,
  DeleteComputerMemoryRecordMutation,
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

function StrategyBadge({ strategy }: { strategy: string | null }) {
  if (!strategy) return null;
  const colors = STRATEGY_COLORS[strategy] || "bg-muted text-muted-foreground";
  return (
    <Badge className={`${colors} whitespace-nowrap font-normal text-xs`}>
      {strategyLabel(strategy)}
    </Badge>
  );
}

export function SettingsMemory() {
  const { tenantId } = useTenant();
  const [view, setView] = useState<BrainView>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<MemoryGraphHandle>(null);
  usePageHeaderActions({ title: "Memory", breadcrumbs: [{ label: "Memory" }] });

  const effectiveTenantId = tenantId ?? null;
  const requesterUserId = null;
  const namespace = "requester";

  const [recordsResult, refetchRecords] = useQuery<{
    memoryRecords?: any[] | null;
  }>({
    query: ComputerMemoryRecordsQuery,
    variables: {
      tenantId: effectiveTenantId,
      userId: requesterUserId,
      namespace,
    },
    pause: !!activeSearch || !effectiveTenantId,
  });

  const [searchResult] = useQuery<{
    memorySearch?: { records: any[] | null } | null;
  }>({
    query: ComputerMemorySearchQuery,
    variables: {
      tenantId: effectiveTenantId,
      userId: requesterUserId,
      query: activeSearch,
      limit: 50,
    },
    pause: !activeSearch || !effectiveTenantId,
  });

  const [, deleteMemoryRecord] = useMutation(
    DeleteComputerMemoryRecordMutation,
  );

  const [selectedRecord, setSelectedRecord] = useState<MemoryRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    if (activeSearch) return searchResult.data?.memorySearch?.records ?? [];
    return recordsResult.data?.memoryRecords ?? [];
  }, [activeSearch, searchResult.data, recordsResult.data]);

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

  const handleForget = useCallback(async () => {
    if (!selectedRecord || !effectiveTenantId) return;
    setDeleting(true);
    try {
      const result = await deleteMemoryRecord({
        tenantId: effectiveTenantId,
        userId: requesterUserId,
        memoryRecordId: selectedRecord.memoryRecordId,
      });
      if (result.error) throw result.error;
      setSheetOpen(false);
      setSelectedRecord(null);
      refetchRecords({ requestPolicy: "network-only" });
    } finally {
      setDeleting(false);
    }
  }, [selectedRecord, effectiveTenantId, deleteMemoryRecord, refetchRecords]);

  const isLoading = activeSearch
    ? searchResult.fetching && !searchResult.data
    : recordsResult.fetching && !recordsResult.data;

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Memory"
        description="Inspect and manage what your agents remember across threads."
      />
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <div className="relative w-fit min-w-56 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search memories..."
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
                ? "No memories match your search."
                : "No memories have been captured yet."}
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
            allowHorizontalScroll={false}
            pageSize={25}
            tableClassName="table-fixed"
          />
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        {selectedRecord && (
          <MemoryDetailSheet
            record={selectedRecord}
            deleting={deleting}
            onForget={handleForget}
          />
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
