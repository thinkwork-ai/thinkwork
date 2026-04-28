import { useState, useCallback, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2, Trash2, Brain, Search, RefreshCw, X, ArrowLeft } from "lucide-react";
import {
  AgentDetailQuery,
  MemoryRecordsQuery,
  MemorySearchQuery,
  MemorySystemConfigQuery,
  DeleteMemoryRecordMutation,
  UpdateMemoryRecordMutation,
} from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MemoryGraph, type MemoryGraphHandle, type MemoryGraphNode } from "@/components/MemoryGraph";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId_/memory")({
  component: AgentMemoryPage,
});

/** Parse <topic name="...">content</topic> tags into structured sections.
 *  Handles both closed and unclosed topic tags. */
function parseMemoryTopics(text: string): { topic: string; content: string }[] {
  const regex = /<topic\s+name="([^"]*)">\s*([\s\S]*?)(?:<\/topic>|(?=<topic\s)|$)/g;
  const sections: { topic: string; content: string }[] = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) sections.push({ topic: "", content: before });
    sections.push({ topic: match[1], content: match[2].trim() });
    lastIndex = regex.lastIndex;
  }
  const after = text.slice(lastIndex).trim();
  if (after) sections.push({ topic: "", content: after });
  if (sections.length === 0) sections.push({ topic: "", content: text });
  return sections;
}

function stripTopicTags(text: string): string {
  return text.replace(/<\/?topic[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function MemoryContent({ text }: { text: string }) {
  const sections = parseMemoryTopics(text);
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={i}>
          {s.topic && (
            <p className="font-medium text-xs text-muted-foreground uppercase tracking-wider mb-1">{s.topic}</p>
          )}
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{s.content}</p>
        </div>
      ))}
    </div>
  );
}

type MemoryRow = {
  memoryRecordId: string;
  text: string;
  createdAt: string | null;
  updatedAt: string | null;
  strategyId: string | null;
  namespace: string | null;
  strategy: string | null;
  score: number | null;
};

const STRATEGY_COLORS: Record<string, string> = {
  semantic: "bg-blue-500/20 text-blue-400",
  preferences: "bg-purple-500/20 text-purple-400",
  summaries: "bg-yellow-500/20 text-yellow-400",
  episodes: "bg-green-500/20 text-green-400",
  reflections: "bg-orange-500/20 text-orange-400",
};

function StrategyBadge({ strategy }: { strategy: string | null }) {
  if (!strategy) return null;
  const colors = STRATEGY_COLORS[strategy] || "bg-muted text-muted-foreground";
  const label = strategy.charAt(0).toUpperCase() + strategy.slice(1);
  return <Badge className={`${colors} font-normal text-xs`}>{label}</Badge>;
}

const columns: ColumnDef<MemoryRow>[] = [
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
    accessorKey: "strategy",
    header: "Strategy",
    size: 120,
    cell: ({ row }) => <StrategyBadge strategy={row.original.strategy} />,
  },
  {
    accessorKey: "text",
    header: "Memory",
    cell: ({ row }) => (
      <span className="truncate block">{stripTopicTags(row.original.text)}</span>
    ),
  },
];

const STRATEGY_FILTERS = [
  { label: "All", value: "" },
  { label: "Facts", value: "SEMANTIC" },
  { label: "Preferences", value: "PREFERENCES" },
  { label: "Episodes", value: "EPISODES" },
];

function AgentMemoryPage() {
  const { agentId } = Route.useParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [view, setView] = useState<string>("memories");

  // Hide the Knowledge Graph toggle entirely when Hindsight is not
  // deployed — managed AgentCore Memory has no entity graph to render.
  const [memorySystemConfigResult] = useQuery({ query: MemorySystemConfigQuery });
  const hindsightEnabled = memorySystemConfigResult.data?.memorySystemConfig?.hindsightEnabled ?? false;
  useEffect(() => {
    if (!hindsightEnabled && view === "graph") setView("memories");
  }, [hindsightEnabled, view]);

  const graphRef = useRef<MemoryGraphHandle>(null);

  const [agentResult] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });

  const agent = agentResult.data?.agent;
  const userId = agent?.humanPairId ?? agent?.humanPair?.id;
  const namespace = "all";

  // Default: list records from namespace
  const [memoryResult, refetchMemory] = useQuery({
    query: MemoryRecordsQuery,
    variables: { userId: userId ?? "", namespace },
    pause: !!activeSearch || !userId,
  });

  // Search mode: semantic search
  const [searchResult] = useQuery({
    query: MemorySearchQuery,
    variables: {
      userId: userId ?? "",
      query: activeSearch,
      strategy: (strategyFilter || undefined) as any,
      limit: 50,
    },
    pause: !activeSearch || !userId,
  });

  const [, deleteMemory] = useMutation(DeleteMemoryRecordMutation);
  const [, updateMemory] = useMutation(UpdateMemoryRecordMutation);
  const [selectedRecord, setSelectedRecord] = useState<MemoryRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Graph node detail sheet
  const [graphNode, setGraphNode] = useState<MemoryGraphNode | null>(null);
  const [graphNodeEdges, setGraphNodeEdges] = useState<{ label: string; targetLabel: string; targetType: string; targetId: string }[]>([]);
  const [graphSheetOpen, setGraphSheetOpen] = useState(false);
  const [graphNodeHistory, setGraphNodeHistory] = useState<{ node: MemoryGraphNode; edges: { label: string; targetLabel: string; targetType: string; targetId: string }[] }[]>([]);

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: agent?.name ?? "...", href: `/agents/${agentId}` },
    { label: "Memory" },
  ]);

  // Build rows from either list or search results
  const rows: MemoryRow[] = activeSearch
    ? (searchResult.data?.memorySearch?.records ?? []).map((r) => ({
        memoryRecordId: r.memoryRecordId,
        text: r.content?.text ?? "",
        createdAt: r.createdAt ?? null,
        updatedAt: null,
        strategyId: null,
        namespace: r.namespace ?? null,
        strategy: r.strategy ?? null,
        score: r.score ?? null,
      }))
    : (memoryResult.data?.memoryRecords ?? [])
        .map((r) => ({
          memoryRecordId: r.memoryRecordId,
          text: r.content?.text ?? "",
          createdAt: r.createdAt ?? null,
          updatedAt: r.updatedAt ?? null,
          strategyId: r.strategyId ?? null,
          namespace: r.namespace ?? null,
          strategy: inferStrategy(r.strategyId ?? "", r.namespace ?? ""),
          score: null,
        }))
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const handleRowClick = useCallback((row: MemoryRow) => {
    setSelectedRecord(row);
    setEditValue(row.text);
    setEditing(false);
    setSheetOpen(true);
  }, []);

  const handleSearch = () => {
    setActiveSearch(searchQuery.trim());
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setActiveSearch("");
  };

  const handleSave = async () => {
    if (!selectedRecord || !userId) return;
    setSaving(true);
    try {
      await updateMemory({
        userId,
        memoryRecordId: selectedRecord.memoryRecordId,
        content: editValue,
      });
      setSelectedRecord({ ...selectedRecord, text: editValue });
      setEditing(false);
      refetchMemory({ requestPolicy: "network-only" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRecord || !userId) return;
    setDeleting(true);
    try {
      await deleteMemory({ userId, memoryRecordId: selectedRecord.memoryRecordId });
      setSheetOpen(false);
      setSelectedRecord(null);
      refetchMemory({ requestPolicy: "network-only" });
    } finally {
      setDeleting(false);
    }
  };

  if (agentResult.fetching && !agentResult.data) return <PageSkeleton />;

  const isLoading = activeSearch
    ? searchResult.fetching && !searchResult.data
    : memoryResult.fetching && !memoryResult.data;

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)]">
      <div className="shrink-0 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-tight text-foreground">Memory</h1>
              <p className="text-sm text-muted-foreground">
                {isLoading
                  ? "Loading..."
                  : activeSearch
                    ? `${rows.length} result${rows.length !== 1 ? "s" : ""} for "${activeSearch}"`
                    : `${rows.length} memor${rows.length !== 1 ? "ies" : "y"}`}
              </p>
            </div>
            {hindsightEnabled && (
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={view}
                onValueChange={(val) => { if (val) setView(val); }}
              >
                <ToggleGroupItem value="memories" className="h-7 text-xs px-3">Memory</ToggleGroupItem>
                <ToggleGroupItem value="graph" className="h-7 text-xs px-3">Knowledge Graph</ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (view === "graph") graphRef.current?.refetch();
                else refetchMemory({ requestPolicy: "network-only" });
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Search + filters — only shown in memories view */}
      {view === "memories" && (
        <div className="flex items-center gap-2 pb-3 shrink-0">
          <div className="relative max-w-md" style={{ width: "22rem" }}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-8 pr-7 h-9 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setActiveSearch(""); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={strategyFilter}
            onValueChange={(val) => {
              setStrategyFilter(val);
              if (activeSearch) setActiveSearch(searchQuery.trim());
            }}
          >
            {STRATEGY_FILTERS.map((f) => (
              <ToggleGroupItem
                key={f.value}
                value={f.value}
                className="h-7 text-xs px-3"
              >
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      {view === "memories" ? (
        <div className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading memories...
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Brain className="h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {activeSearch
                  ? "No memories match your search."
                  : "No memories yet. Memory is created automatically as the agent interacts with users."}
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
      ) : (
        <div className="flex-1 min-h-0 relative border border-muted rounded-lg overflow-hidden">
          <MemoryGraph
            ref={graphRef}
            userId={userId}
            onNodeClick={(node, edges) => {
              setGraphNode(node);
              setGraphNodeEdges(edges);
              setGraphNodeHistory([]);
              setGraphSheetOpen(true);
            }}
          />
        </div>
      )}

      {/* Memory detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col">
          <SheetHeader className="p-6 pb-0">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="flex items-center gap-2">
                  Memory Detail
                  <StrategyBadge strategy={selectedRecord?.strategy ?? null} />
                </SheetTitle>
                <SheetDescription>
                  {selectedRecord?.createdAt
                    ? `Created ${new Date(selectedRecord.createdAt).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}`
                    : "Memory record"}
                </SheetDescription>
              </div>
              {!editing && hindsightEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 pt-4">
            {editing ? (
              <>
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="min-h-[200px] font-mono text-sm resize-none"
                />
                <div className="flex items-center gap-2 pt-4">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={deleting}>
                        {deleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete memory?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This memory will be permanently removed. This action
                          cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditValue(selectedRecord?.text ?? "");
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || editValue === selectedRecord?.text}
                  >
                    {saving && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    )}
                    Save
                  </Button>
                </div>
              </>
            ) : (
              <>
                <MemoryContent text={selectedRecord?.text ?? ""} />
                {!hindsightEnabled && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    AgentCore memory records are immutable in this deployment. To change a fact,
                    create a new memory instead.
                  </p>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Graph node detail sheet */}
      <Sheet open={graphSheetOpen} onOpenChange={setGraphSheetOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col">
          <SheetHeader className="p-6 pb-0">
            <SheetTitle className="flex items-center gap-2">
              {graphNodeHistory.length > 0 && (
                <button
                  onClick={() => {
                    const prev = graphNodeHistory[graphNodeHistory.length - 1];
                    setGraphNodeHistory((h) => h.slice(0, -1));
                    setGraphNode(prev.node);
                    setGraphNodeEdges(prev.edges);
                  }}
                  className="text-muted-foreground hover:text-foreground -ml-1 mr-1"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              {graphNode?.nodeType === "memory" ? "Memory" : graphNode?.label}
              <Badge
                className={`font-normal text-xs ${
                  graphNode?.nodeType === "memory"
                    ? "bg-pink-500/20 text-pink-400"
                    : "bg-sky-500/20 text-sky-400"
                }`}
              >
                {graphNode?.nodeType === "memory"
                  ? graphNode?.strategy ?? "memory"
                  : graphNode?.entityType ?? "entity"}
              </Badge>
            </SheetTitle>
            <SheetDescription>
              {graphNode?.nodeType === "memory"
                ? `Memory node — ${graphNodeEdges.length} connection${graphNodeEdges.length !== 1 ? "s" : ""}`
                : `Entity — ${graphNodeEdges.length} mention${graphNodeEdges.length !== 1 ? "s" : ""}`}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 pt-4 space-y-4">
            {graphNode?.nodeType === "memory" && (
              <MemoryContent text={graphNode.label} />
            )}

            {graphNodeEdges.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {graphNode?.nodeType === "memory" ? "Mentions" : "Mentioned by"}
                </h4>
                <div className="space-y-2">
                  {graphNodeEdges.map((edge, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-sm rounded-md bg-muted/30 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => {
                        const result = graphRef.current?.getNodeWithEdges(edge.targetId);
                        if (result && graphNode) {
                          setGraphNodeHistory((h) => [...h, { node: graphNode, edges: graphNodeEdges }]);
                          setGraphNode(result.node);
                          setGraphNodeEdges(result.edges);
                        }
                      }}
                    >
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] mt-0.5 ${
                          edge.targetType === "memory"
                            ? "border-pink-500/30 text-pink-400"
                            : "border-sky-500/30 text-sky-400"
                        }`}
                      >
                        {edge.targetType === "memory" ? "Memory" : "Entity"}
                      </Badge>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{stripTopicTags(edge.targetLabel)}</p>
                        {edge.label && (
                          <p className="text-xs text-muted-foreground">{edge.label}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {graphNodeEdges.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No connections found for this node.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Infer strategy from strategyId or namespace */
function inferStrategy(strategyId: string, namespace: string): string {
  if (strategyId.includes("semantic")) return "semantic";
  if (strategyId.includes("summary") || strategyId.includes("Summar")) return "summaries";
  if (strategyId.includes("Preference") || strategyId.includes("preference")) return "preferences";
  if (strategyId.includes("Episode") || strategyId.includes("episode")) return "episodes";
  if (namespace.startsWith("assistant_")) return "semantic";
  if (namespace.startsWith("preferences_")) return "preferences";
  if (namespace.startsWith("session_")) return "summaries";
  if (namespace.startsWith("episodes_")) return "episodes";
  return "semantic";
}
