import { useState, useCallback, useMemo, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2, Trash2, Brain, Search, X } from "lucide-react";
import {
  AgentsListQuery,
  MemoryRecordsQuery,
  MemorySearchQuery,
  DeleteMemoryRecordMutation,
  UpdateMemoryRecordMutation,
} from "@/lib/graphql-queries";
import { MemoryGraph, type MemoryGraphHandle } from "@/components/MemoryGraph";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export const Route = createFileRoute("/_authed/_tenant/memory/")({
  component: MemoryPage,
});

/** Parse <topic name="...">content</topic> tags into structured sections.
 *  Handles both closed and unclosed topic tags. */
function parseMemoryTopics(text: string): { topic: string; content: string }[] {
  // Match closed tags: <topic name="X">content</topic>
  // AND unclosed tags: <topic name="X">content (rest of string or until next <topic)
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

/** Strip topic XML tags for plain text display */
function stripTopicTags(text: string): string {
  return text.replace(/<\/?topic[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** Render parsed memory sections */
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
  agentSlug: string | null;
  agentName: string;
  factType: string | null;
  confidence: number | null;
  eventDate: string | null;
  occurredStart: string | null;
  occurredEnd: string | null;
  mentionedAt: string | null;
  tags: string[] | null;
  accessCount: number;
  proofCount: number | null;
  context: string | null;
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


function MemoryPage() {
  const { tenantId } = useTenant();
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [view, setView] = useState<"memories" | "graph">("memories");
  const graphRef = useRef<MemoryGraphHandle>(null);


  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId },
  });

  const agents = useMemo(
    () => [...(agentsResult.data?.agents ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [agentsResult.data]
  );
  const agentNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents) map[a.id] = a.name;
    return map;
  }, [agents]);
  const agentNamesBySlug = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents) if (a.slug) map[a.slug] = a.name;
    return map;
  }, [agents]);

  const isAllAgents = selectedAgentId === "all";
  const effectiveAgentId = isAllAgents ? agents[0]?.id : selectedAgentId;
  const effectiveAgentIds = useMemo(
    () => isAllAgents ? agents.map((a) => a.id) : [],
    [isAllAgents, agents]
  );

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const namespace = selectedAgent?.slug ? `assistant_${selectedAgent.slug}` : effectiveAgentId ? `assistant_${effectiveAgentId}` : "";

  // Memory records — pass "all" for all-agents mode, resolver handles it
  const memoriesAgentId = isAllAgents ? "all" : selectedAgentId;

  const [memoryResult, refetchMemory] = useQuery({
    query: MemoryRecordsQuery,
    variables: { assistantId: memoriesAgentId, namespace: namespace || "all" },
    pause: !!activeSearch,
  });

  // Search mode
  const [searchResult] = useQuery({
    query: MemorySearchQuery,
    variables: {
      assistantId: isAllAgents ? (agents[0]?.id ?? "") : selectedAgentId,
      query: activeSearch,
      limit: 50,
    },
    pause: !activeSearch || (!isAllAgents && !selectedAgentId),
  });

  const [, deleteMemory] = useMutation(DeleteMemoryRecordMutation);
  const [, updateMemory] = useMutation(UpdateMemoryRecordMutation);
  const [selectedRecord, setSelectedRecord] = useState<MemoryRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useBreadcrumbs([{ label: "Memories" }]);

  const mapRecord = (r: any): MemoryRow => ({
    memoryRecordId: r.memoryRecordId,
    text: r.content?.text ?? "",
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
    strategyId: r.strategyId ?? null,
    namespace: r.namespace ?? null,
    strategy: r.strategy ?? inferStrategy(r.strategyId ?? "", r.namespace ?? ""),
    score: r.score ?? null,
    agentSlug: r.agentSlug ?? r.namespace ?? null,
    agentName: agentNamesBySlug[r.agentSlug ?? r.namespace ?? ""] ?? r.agentSlug ?? "",
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
  });

  const rows: MemoryRow[] = activeSearch
    ? (searchResult.data?.memorySearch?.records ?? []).map(mapRecord)
    : (memoryResult.data?.memoryRecords ?? [])
        .map(mapRecord)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

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
          : "\u2014",
    },
    {
      accessorKey: "agentName",
      header: "Agent",
      size: 100,
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.agentName}</span>,
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
  ];

  const handleRowClick = useCallback((row: MemoryRow) => {
    setSelectedRecord(row);
    setEditValue(row.text);
    setEditing(false);
    setSheetOpen(true);
  }, []);

  const handleSearch = () => {
    setActiveSearch(searchQuery.trim());
  };

  const handleSave = async () => {
    if (!selectedRecord) return;
    setSaving(true);
    try {
      await updateMemory({
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
    if (!selectedRecord) return;
    setDeleting(true);
    try {
      await deleteMemory({ memoryRecordId: selectedRecord.memoryRecordId });
      setSheetOpen(false);
      setSelectedRecord(null);
      refetchMemory({ requestPolicy: "network-only" });
    } finally {
      setDeleting(false);
    }
  };

  if (agentsResult.fetching && !agentsResult.data) return <PageSkeleton />;

  const isLoading = (activeSearch
    ? searchResult.fetching && !searchResult.data
    : memoryResult.fetching && !memoryResult.data);

  const memoryCount = isAllAgents ? agents.length + " agents" : `${rows.length} memor${rows.length !== 1 ? "ies" : "y"}`;

  return (
    <div className="flex flex-col -m-6 h-[calc(100%+48px)] min-w-0">
      <div className="shrink-0 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Memories</h1>
            <p className="text-xs text-muted-foreground">{memoryCount}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "memories" | "graph")} variant="outline">
              <ToggleGroupItem value="graph" className="px-3 text-xs">Knowledge Graph</ToggleGroupItem>
              <ToggleGroupItem value="memories" className="px-3 text-xs">Memories</ToggleGroupItem>
            </ToggleGroup>
            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {view === "memories" && (
        <div className="flex items-center gap-4 pb-3 px-4 shrink-0">
          <div className="relative" style={{ width: "16rem" }}>
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
                onClick={() => { setSearchQuery(""); setActiveSearch(""); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 px-4">
        {view === "graph" ? (
          <div className="h-full border border-border rounded-lg overflow-hidden">
            <MemoryGraph
              ref={graphRef}
              agentId={isAllAgents ? undefined : selectedAgentId}
              agentIds={isAllAgents ? agents.map((a) => a.id) : undefined}
              agentNames={agentNames}
            />
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading memories...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {activeSearch
                ? "No memories match your search."
                : "No memories yet."}
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

      {/* Detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col">
          <SheetHeader className="p-6 pb-0">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle>Memory Detail</SheetTitle>
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
              {!editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
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
                        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete memory?</AlertDialogTitle>
                        <AlertDialogDescription>This memory will be permanently removed.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <div className="flex-1" />
                  <Button variant="outline" size="sm" onClick={() => { setEditValue(selectedRecord?.text ?? ""); setEditing(false); }}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || editValue === selectedRecord?.text}>
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Save
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                {selectedRecord?.factType && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{selectedRecord.factType}</p>
                    <StrategyBadge strategy={selectedRecord?.strategy ?? null} />
                  </div>
                )}
                <MemoryContent text={selectedRecord?.text ?? ""} />

                <div className="border-t border-muted pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {selectedRecord?.agentName && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Agent</p>
                        <p className="mt-0.5">{selectedRecord.agentName}</p>
                      </div>
                    )}
                    {selectedRecord?.confidence != null && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Confidence</p>
                        <p className="mt-0.5">{(selectedRecord.confidence * 100).toFixed(0)}%</p>
                      </div>
                    )}
                    {selectedRecord?.accessCount != null && selectedRecord.accessCount > 0 && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Access Count</p>
                        <p className="mt-0.5">{selectedRecord.accessCount}</p>
                      </div>
                    )}
                    {selectedRecord?.proofCount != null && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Proof Count</p>
                        <p className="mt-0.5">{selectedRecord.proofCount}</p>
                      </div>
                    )}
                    {selectedRecord?.context && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Context</p>
                        <p className="mt-0.5 truncate">{selectedRecord.context}</p>
                      </div>
                    )}
                  </div>

                  {/* Bi-temporal dates */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {selectedRecord?.eventDate && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Event Date</p>
                        <p className="mt-0.5">{new Date(selectedRecord.eventDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                      </div>
                    )}
                    {selectedRecord?.mentionedAt && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Mentioned At</p>
                        <p className="mt-0.5">{new Date(selectedRecord.mentionedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                      </div>
                    )}
                    {selectedRecord?.occurredStart && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Occurred Start</p>
                        <p className="mt-0.5">{new Date(selectedRecord.occurredStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                      </div>
                    )}
                    {selectedRecord?.occurredEnd && (
                      <div>
                        <p className="text-muted-foreground uppercase tracking-wider font-medium">Occurred End</p>
                        <p className="mt-0.5">{new Date(selectedRecord.occurredEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  {selectedRecord?.tags && selectedRecord.tags.length > 0 && (
                    <div className="text-xs">
                      <p className="text-muted-foreground uppercase tracking-wider font-medium mb-1">Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedRecord.tags.map((t) => (
                          <Badge key={t} variant="outline" className="font-normal text-xs">{t}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

    </div>
  );
}

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

