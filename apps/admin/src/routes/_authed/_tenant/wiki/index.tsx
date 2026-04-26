import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useClient } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2, Search, X, Sparkles } from "lucide-react";
import {
  AgentsListQuery,
  RecentWikiPagesQuery,
  WikiSearchQuery,
} from "@/lib/graphql-queries";
import { WikiGraph, type WikiGraphHandle, type WikiGraphNode } from "@/components/WikiGraph";
import { WikiPageSheet, type WikiPageSheetEdge } from "@/components/WikiPageSheet";
import {
  PAGE_TYPE_BADGE_CLASSES,
  pageTypeLabel,
  type WikiPageType,
} from "@/lib/wiki-palette";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";

type WikiView = "pages" | "graph";

function isWikiView(v: unknown): v is WikiView {
  return v === "pages" || v === "graph";
}

export const Route = createFileRoute("/_authed/_tenant/wiki/")({
  component: WikiPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { agent?: string; view?: WikiView } => ({
    ...(typeof search.agent === "string" && search.agent ? { agent: search.agent } : {}),
    ...(isWikiView(search.view) ? { view: search.view } : {}),
  }),
});

type WikiRow = {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
  summary: string | null;
  lastCompiledAt: string | null;
  updatedAt: string | null;
  userId: string;
  agentId: string;
  agentName: string;
};

type UserScope = {
  userId: string;
  label: string;
  agentIds: string[];
};

function agentUserId(agent: any): string | null {
  return agent.humanPairId ?? agent.humanPair?.id ?? null;
}

function agentUserLabel(agent: any): string {
  return agent.humanPair?.name ?? agent.humanPair?.email ?? agent.name;
}

function PageTypeBadge({ type }: { type: WikiPageType }) {
  return (
    <Badge
      className={`font-normal text-xs ${
        PAGE_TYPE_BADGE_CLASSES[type] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {pageTypeLabel(type)}
    </Badge>
  );
}

function WikiPage() {
  const { tenantId } = useTenant();
  const { agent, view: viewParam } = Route.useSearch();
  const navigate = useNavigate();
  const selectedAgentId = agent ?? "all";
  const view: WikiView = viewParam ?? "pages";
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const graphRef = useRef<WikiGraphHandle>(null);

  const updateFilters = useCallback(
    (next: { agent?: string; view?: WikiView }) => {
      navigate({
        to: "/wiki",
        search: {
          ...(next.agent && next.agent !== "all" ? { agent: next.agent } : {}),
          ...(next.view && next.view !== "pages" ? { view: next.view } : {}),
        },
        replace: true,
      });
    },
    [navigate],
  );
  const setSelectedAgentId = useCallback(
    (nextAgent: string) => updateFilters({ agent: nextAgent, view }),
    [updateFilters, view],
  );
  const setView = useCallback(
    (nextView: WikiView) => updateFilters({ agent: selectedAgentId, view: nextView }),
    [updateFilters, selectedAgentId],
  );

  // List-row detail sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<WikiRow | null>(null);

  // Graph-node detail sheet (separate state so user can toggle between
  // views without losing their place)
  const [graphNode, setGraphNode] = useState<WikiGraphNode | null>(null);
  const [graphNodeEdges, setGraphNodeEdges] = useState<WikiPageSheetEdge[]>([]);
  const [graphSheetOpen, setGraphSheetOpen] = useState(false);
  const [graphNodeHistory, setGraphNodeHistory] = useState<
    { node: WikiGraphNode; edges: WikiPageSheetEdge[] }[]
  >([]);

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const agents = useMemo(
    () =>
      [...(agentsResult.data?.agents ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [agentsResult.data],
  );

  const userScopes = useMemo<UserScope[]>(() => {
    const map = new Map<string, UserScope>();
    for (const a of agents) {
      const userId = agentUserId(a);
      if (!userId) continue;
      const existing = map.get(userId);
      if (existing) {
        existing.agentIds.push(a.id);
        continue;
      }
      map.set(userId, {
        userId,
        label: agentUserLabel(a),
        agentIds: [a.id],
      });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [agents]);
  const userLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const scope of userScopes) map[scope.userId] = scope.label;
    return map;
  }, [userScopes]);

  const isAllAgents = selectedAgentId === "all";
  const selectedScope = userScopes.find(
    (scope) => scope.userId === selectedAgentId || scope.agentIds.includes(selectedAgentId),
  );
  const selectedScopeId = isAllAgents ? "all" : (selectedScope?.userId ?? selectedAgentId);
  const effectiveUserId = isAllAgents ? userScopes[0]?.userId : selectedScope?.userId;
  const effectiveUserIds = useMemo(
    () => (isAllAgents ? userScopes.map((scope) => scope.userId) : []),
    [isAllAgents, userScopes],
  );

  // Single-user list
  const [listResult, refetchList] = useQuery({
    query: RecentWikiPagesQuery,
    variables: { userId: effectiveUserId ?? "", limit: 100 },
    pause: !!activeSearch || isAllAgents || !effectiveUserId,
  });

  // Multi-user list fan-out — same client.query pattern Memories
  // uses to dodge the resolver's "all" branch and to give each user their
  // own owner scope.
  const client = useClient();
  const [multiPages, setMultiPages] = useState<WikiRow[] | null>(null);
  const [multiFetching, setMultiFetching] = useState(false);

  const fetchAllAgentPages = useCallback(async () => {
    if (!isAllAgents || userScopes.length === 0 || activeSearch) return;
    setMultiFetching(true);
    try {
      const perAgent = await Promise.all(
        userScopes.map(async (scope) => {
          try {
            const res = await client
              .query(RecentWikiPagesQuery, { userId: scope.userId, limit: 100 })
              .toPromise();
            const pages = res.data?.recentWikiPages ?? [];
            return pages.map((p: any) => toRow(p, scope.userId, scope.label));
          } catch {
            return [] as WikiRow[];
          }
        }),
      );
      setMultiPages(perAgent.flat());
    } finally {
      setMultiFetching(false);
    }
  }, [isAllAgents, userScopes, activeSearch, client]);

  useEffect(() => {
    if (isAllAgents && !activeSearch) {
      fetchAllAgentPages();
    } else {
      setMultiPages(null);
    }
  }, [isAllAgents, activeSearch, fetchAllAgentPages]);

  // Search — single user in v1. All-Users + search is deferred; we
  // fall back to the first user's scope so the user sees *something*
  // rather than an empty panel.
  const searchUserId = isAllAgents ? (userScopes[0]?.userId ?? "") : (effectiveUserId ?? "");
  const [searchResult] = useQuery({
    query: WikiSearchQuery,
    variables: {
      tenantId: tenantId ?? "",
      userId: searchUserId,
      query: activeSearch,
      limit: 50,
    },
    pause: !activeSearch || !tenantId || !searchUserId,
  });

  useBreadcrumbs([{ label: "Wiki Pages" }]);

  const toRow = (p: any, userId: string, userName: string): WikiRow => ({
    id: p.id,
    type: p.type as WikiPageType,
    slug: p.slug,
    title: p.title,
    summary: p.summary ?? null,
    lastCompiledAt: p.lastCompiledAt ?? null,
    updatedAt: p.updatedAt ?? null,
    userId,
    agentId: userId,
    agentName: userName,
  });

  const rows: WikiRow[] = useMemo(() => {
    if (activeSearch) {
      const hits = searchResult.data?.wikiSearch ?? [];
      return hits.map((h: any) =>
        toRow(h.page, searchUserId, userLabels[searchUserId] ?? ""),
      );
    }
    if (isAllAgents) {
      return (multiPages ?? []).slice().sort((a, b) => {
        const da = a.lastCompiledAt ?? a.updatedAt ?? "";
        const db = b.lastCompiledAt ?? b.updatedAt ?? "";
        return db.localeCompare(da);
      });
    }
    const pages = listResult.data?.recentWikiPages ?? [];
    return pages.map((p: any) =>
      toRow(p, effectiveUserId ?? "", userLabels[effectiveUserId ?? ""] ?? ""),
    );
  }, [
    activeSearch,
    searchResult.data,
    isAllAgents,
    multiPages,
    listResult.data,
    effectiveUserId,
    searchUserId,
    userLabels,
  ]);

  const columns: ColumnDef<WikiRow>[] = [
    {
      accessorKey: "lastCompiledAt",
      header: "Date",
      size: 140,
      cell: ({ row }) => {
        const d = row.original.lastCompiledAt ?? row.original.updatedAt;
        return d
          ? new Date(d).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "\u2014";
      },
    },
    {
      accessorKey: "agentName",
      header: "User",
      size: 120,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">{row.original.agentName}</span>
      ),
    },
    {
      accessorKey: "type",
      header: "Type",
      size: 110,
      cell: ({ row }) => <PageTypeBadge type={row.original.type} />,
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => (
        <span className="font-medium truncate block">{row.original.title}</span>
      ),
    },
  ];

  const handleRowClick = useCallback((row: WikiRow) => {
    setSelectedRow(row);
    setSheetOpen(true);
  }, []);

  const handleSearch = () => {
    setActiveSearch(searchQuery.trim());
  };

  if (agentsResult.fetching && !agentsResult.data) return <PageSkeleton />;

  const isLoading = activeSearch
    ? searchResult.fetching && !searchResult.data
    : isAllAgents
      ? multiFetching && multiPages === null
      : listResult.fetching && !listResult.data;

  const headerCount = isAllAgents
    ? `${userScopes.length} user${userScopes.length === 1 ? "" : "s"}`
    : `${rows.length} page${rows.length !== 1 ? "s" : ""}`;

  return (
    <div className="flex flex-col -m-6 h-[calc(100%+48px)] min-w-0">
      <div className="shrink-0 px-4 pt-3 pb-3 relative z-10">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Wiki Pages</h1>
            <p className="text-xs text-muted-foreground">{headerCount}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(v) => v && setView(v as "pages" | "graph")}
              variant="outline"
            >
              <ToggleGroupItem value="pages" className="px-3 text-xs">Table</ToggleGroupItem>
              <ToggleGroupItem value="graph" className="px-3 text-xs">Graph</ToggleGroupItem>
            </ToggleGroup>
            <Select value={selectedScopeId} onValueChange={setSelectedAgentId}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {userScopes.map((scope) => (
                  <SelectItem key={scope.userId} value={scope.userId}>{scope.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 pb-3 px-4 shrink-0 relative z-10">
        <div className="relative" style={{ width: "16rem" }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search pages..."
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
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4">
        {view === "graph" ? (
          <div className="h-full relative border border-border rounded-lg overflow-hidden">
            <WikiGraph
              ref={graphRef}
              tenantId={tenantId ?? ""}
              userId={isAllAgents ? undefined : effectiveUserId}
              userIds={isAllAgents ? effectiveUserIds : undefined}
              searchQuery={searchQuery || undefined}
              onNodeClick={(node, edges) => {
                setGraphNode(node);
                setGraphNodeEdges(edges);
                setGraphNodeHistory([]);
                setGraphSheetOpen(true);
              }}
            />
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading pages...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Sparkles className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground max-w-sm">
              {activeSearch
                ? "No pages match your search."
                : "No compiled pages yet — ask an agent a few questions and come back in a few minutes."}
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

      {/* List-row detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col">
          {selectedRow && (
            <WikiPageSheet
              tenantId={tenantId ?? ""}
              userId={selectedRow.userId}
              type={selectedRow.type}
              slug={selectedRow.slug}
              title={selectedRow.title}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Graph-node detail sheet (with re-anchoring history) */}
      <Sheet open={graphSheetOpen} onOpenChange={setGraphSheetOpen}>
        <SheetContent className="sm:max-w-lg flex flex-col">
          {graphNode && (
            <WikiPageSheet
              tenantId={tenantId ?? ""}
              userId={graphNode.agentId}
              type={graphNode.entityType}
              slug={graphNode.slug}
              title={graphNode.label}
              connectedEdges={graphNodeEdges}
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
        </SheetContent>
      </Sheet>
    </div>
  );
}
