import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Brain, Search, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Sheet,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from "@thinkwork/ui";
import { MEMORY_TABS } from "./memory";
import {
  MemoryGraph,
  type MemoryGraphHandle,
  type MemoryGraphNode,
} from "@thinkwork/graph";
import {
  ComputerMemoryRecordsQuery,
  ComputerMemorySearchQuery,
  DeleteComputerMemoryRecordMutation,
  MyComputerQuery,
} from "@/lib/graphql-queries";
import { LoadingShimmer } from "@/components/LoadingShimmer";
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

function isBrainView(v: unknown): v is BrainView {
  return v === "table" || v === "graph";
}

export const Route = createFileRoute("/_authed/_shell/memory/brain")({
  component: BrainPage,
  validateSearch: (search: Record<string, unknown>): { view?: BrainView } => ({
    ...(isBrainView(search.view) ? { view: search.view } : {}),
  }),
});

interface MyComputerResult {
  myComputer?: {
    id: string;
    tenantId: string;
    ownerUserId: string;
  } | null;
}

interface MemoryRecordsResult {
  memoryRecords?: any[] | null;
}

interface MemorySearchResult {
  memorySearch?: { records: any[] | null } | null;
}

function StrategyBadge({ strategy }: { strategy: string | null }) {
  if (!strategy) return null;
  const colors = STRATEGY_COLORS[strategy] || "bg-muted text-muted-foreground";
  return <Badge className={`${colors} font-normal text-xs`}>{strategyLabel(strategy)}</Badge>;
}

function BrainPage() {
  const { tenantId } = useTenant();
  const { view: viewParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab =
    [...MEMORY_TABS]
      .reverse()
      .find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ?? "";
  const view: BrainView = viewParam ?? "table";
  const setView = useCallback(
    (next: BrainView) => {
      navigate({ search: next === "table" ? {} : { view: next }, replace: true });
    },
    [navigate],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<MemoryGraphHandle>(null);

  const [{ data: computerData }] = useQuery<MyComputerResult>({ query: MyComputerQuery });
  const userId = computerData?.myComputer?.ownerUserId ?? null;
  const effectiveTenantId = tenantId ?? computerData?.myComputer?.tenantId ?? null;
  const namespace = userId ? `user_${userId}` : "";

  const [recordsResult, refetchRecords] = useQuery<MemoryRecordsResult>({
    query: ComputerMemoryRecordsQuery,
    variables: { tenantId: effectiveTenantId, userId, namespace },
    pause: !!activeSearch || !effectiveTenantId || !userId,
  });

  const [searchResult] = useQuery<MemorySearchResult>({
    query: ComputerMemorySearchQuery,
    variables: { tenantId: effectiveTenantId, userId, query: activeSearch, limit: 50 },
    pause: !activeSearch || !userId,
  });

  const [, deleteMemoryRecord] = useMutation(DeleteComputerMemoryRecordMutation);

  const [selectedRecord, setSelectedRecord] = useState<MemoryRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Graph node detail sheet
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
      strategy: r.strategy ?? inferStrategy(r.strategyId ?? "", r.namespace ?? ""),
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
        cell: ({ row }) =>
          row.original.createdAt
            ? new Date(row.original.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "—",
      },
      {
        accessorKey: "factType",
        header: "Type",
        size: 90,
        cell: ({ row }) => <StrategyBadge strategy={row.original.strategy} />,
      },
      {
        accessorKey: "text",
        header: "Memory",
        cell: ({ row }) => (
          <span className="truncate block">{stripTopicTags(row.original.text)}</span>
        ),
      },
    ],
    [],
  );

  const handleRowClick = useCallback((row: MemoryRow) => {
    setSelectedRecord(row);
    setSheetOpen(true);
  }, []);

  const handleSearch = () => {
    setActiveSearch(searchQuery.trim());
  };

  const handleForget = useCallback(async () => {
    if (!selectedRecord || !effectiveTenantId || !userId) return;
    setDeleting(true);
    try {
      const result = await deleteMemoryRecord({
        tenantId: effectiveTenantId,
        userId,
        memoryRecordId: selectedRecord.memoryRecordId,
      });
      if (result.error) throw result.error;
      setSheetOpen(false);
      setSelectedRecord(null);
      refetchRecords({ requestPolicy: "network-only" });
    } finally {
      setDeleting(false);
    }
  }, [selectedRecord, effectiveTenantId, userId, deleteMemoryRecord, refetchRecords]);

  const isLoading = activeSearch
    ? searchResult.fetching && !searchResult.data
    : recordsResult.fetching && !recordsResult.data;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="relative z-10 flex shrink-0 items-center gap-3 px-4 py-3">
        <div className="relative w-fit min-w-56 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search memories..."
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

      <div className="min-h-0 flex-1 px-4">
        {view === "graph" ? (
          <div className="h-full relative border border-border rounded-lg overflow-hidden">
            {userId ? (
              <MemoryGraph
                ref={graphRef}
                userId={userId}
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
                : "Your Computer hasn't remembered anything yet."}
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
