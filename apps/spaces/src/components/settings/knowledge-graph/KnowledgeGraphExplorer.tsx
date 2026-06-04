import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Loader2, Search, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Sheet,
  SheetContent,
  ToggleGroup,
  ToggleGroupItem,
} from "@thinkwork/ui";
import {
  KnowledgeGraph,
  type KnowledgeGraphConnectedEdge,
  type KnowledgeGraphHandle,
  type KnowledgeGraphNode,
} from "@thinkwork/graph";
import {
  KnowledgeGraphGroundingStatus,
  KnowledgeGraphProvenanceStatus,
  type SettingsKnowledgeGraphEntitiesQuery as SettingsKnowledgeGraphEntitiesData,
  type SettingsKnowledgeGraphThreadCandidatesQuery as SettingsKnowledgeGraphThreadCandidatesData,
} from "@/gql/graphql";
import {
  SettingsKnowledgeGraphEntitiesQuery,
  SettingsKnowledgeGraphIngestRunsQuery,
  SettingsKnowledgeGraphThreadCandidatesQuery,
  SettingsStartKnowledgeGraphThreadIngestMutation,
} from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import { KnowledgeGraphEntitySheet } from "./KnowledgeGraphEntitySheet";
import { KnowledgeGraphIngestControls } from "./KnowledgeGraphIngestControls";
import { KnowledgeGraphRunBanner } from "./KnowledgeGraphRunBanner";

type ExplorerView = "table" | "graph";
type EntityRow =
  SettingsKnowledgeGraphEntitiesData["knowledgeGraphEntities"][number];
type ThreadCandidate =
  SettingsKnowledgeGraphThreadCandidatesData["knowledgeGraphThreadCandidates"][number];

const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

export function KnowledgeGraphExplorer() {
  const { tenantId } = useTenant();
  const effectiveTenantId = tenantId ?? null;
  const [view, setView] = useState<ExplorerView>("table");
  const [threadQuery, setThreadQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [ontologyType, setOntologyType] = useState("");
  const [groundingStatus, setGroundingStatus] = useState("");
  const [provenanceStatus, setProvenanceStatus] = useState("");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEntityTitle, setSelectedEntityTitle] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [graphEdges, setGraphEdges] = useState<KnowledgeGraphConnectedEdge[]>(
    [],
  );
  const [history, setHistory] = useState<
    { id: string; title: string; edges: KnowledgeGraphConnectedEdge[] }[]
  >([]);
  const graphRef = useRef<KnowledgeGraphHandle>(null);

  const [threadResult, refetchThreads] = useQuery({
    query: SettingsKnowledgeGraphThreadCandidatesQuery,
    variables: {
      tenantId: effectiveTenantId ?? "",
      query: threadQuery.trim() || null,
      limit: 12,
    },
    pause: !effectiveTenantId,
  });

  const candidates = threadResult.data?.knowledgeGraphThreadCandidates ?? [];

  useEffect(() => {
    if (!selectedThreadId && candidates.length > 0) {
      setSelectedThreadId(candidates[0]!.threadId);
    }
  }, [candidates, selectedThreadId]);

  const selectedThread = useMemo(
    () =>
      candidates.find((candidate) => candidate.threadId === selectedThreadId) ??
      null,
    [candidates, selectedThreadId],
  );

  const groundingFilter = groundingStatus
    ? (groundingStatus as KnowledgeGraphGroundingStatus)
    : null;
  const provenanceFilter = provenanceStatus
    ? (provenanceStatus as KnowledgeGraphProvenanceStatus)
    : null;

  const entityVariables = {
    tenantId: effectiveTenantId ?? "",
    threadId: selectedThreadId ?? "",
    search: activeSearch || null,
    ontologyType: ontologyType || null,
    groundingStatus: groundingFilter,
    provenanceStatus: provenanceFilter,
    limit: 100,
  };

  const [entityResult, refetchEntities] = useQuery({
    query: SettingsKnowledgeGraphEntitiesQuery,
    variables: entityVariables,
    pause: !effectiveTenantId || !selectedThreadId,
  });

  const [runsResult, refetchRuns] = useQuery({
    query: SettingsKnowledgeGraphIngestRunsQuery,
    variables: {
      tenantId: effectiveTenantId ?? "",
      threadId: selectedThreadId ?? "",
      limit: 8,
    },
    pause: !effectiveTenantId || !selectedThreadId,
    requestPolicy: "cache-and-network",
  });

  const [ingestState, startIngest] = useMutation(
    SettingsStartKnowledgeGraphThreadIngestMutation,
  );

  const rows = entityResult.data?.knowledgeGraphEntities ?? [];
  const runs = runsResult.data?.knowledgeGraphIngestRuns ?? [];
  const loadingEntities = entityResult.fetching && !entityResult.data;

  const typeOptions = useMemo(() => {
    const bySlug = new Map<string, string>();
    for (const row of rows) {
      const slug = row.ontologyTypeSlug ?? row.typeLabel ?? "";
      if (!slug) continue;
      bySlug.set(slug, row.typeLabel ?? slug);
    }
    return Array.from(bySlug.entries()).sort((a, b) =>
      a[1].localeCompare(b[1]),
    );
  }, [rows]);

  const columns: ColumnDef<EntityRow>[] = useMemo(
    () => [
      {
        accessorKey: "label",
        header: "Entity",
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} font-medium`}>
            <span className="truncate">{row.original.label}</span>
          </span>
        ),
      },
      {
        accessorKey: "typeLabel",
        header: "Type",
        size: 140,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <Badge variant="outline" className="font-normal">
              {row.original.typeLabel ??
                row.original.ontologyTypeSlug ??
                "Untyped"}
            </Badge>
          </span>
        ),
      },
      {
        accessorKey: "groundingStatus",
        header: "Grounding",
        size: 132,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <TrustBadge
              groundingStatus={row.original.groundingStatus}
              provenanceStatus={row.original.provenanceStatus}
            />
          </span>
        ),
      },
      {
        accessorKey: "relationshipCount",
        header: "Links",
        size: 88,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            {row.original.relationshipCount}
          </span>
        ),
      },
      {
        accessorKey: "evidenceCount",
        header: "Evidence",
        size: 104,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            {row.original.evidenceCount}
          </span>
        ),
      },
      {
        accessorKey: "lastSeenAt",
        header: "Last seen",
        size: 132,
        cell: ({ row }) => (
          <span
            className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
          >
            {formatDate(row.original.lastSeenAt)}
          </span>
        ),
      },
    ],
    [],
  );

  async function ingestSelectedThread() {
    if (!effectiveTenantId || !selectedThreadId) return;
    const result = await startIngest({
      input: {
        tenantId: effectiveTenantId,
        threadId: selectedThreadId,
        force: false,
      },
    });
    if (result.error) {
      toast.error(`Could not start ingest: ${result.error.message}`);
      return;
    }

    toast.success("Knowledge Graph ingest queued");
    refetchRuns({ requestPolicy: "network-only" });
    refetchEntities({ requestPolicy: "network-only" });
    refetchThreads({ requestPolicy: "network-only" });
    graphRef.current?.refetch();
  }

  function openEntity(
    entityId: string,
    title: string,
    edges: KnowledgeGraphConnectedEdge[] = [],
  ) {
    setSelectedEntityId(entityId);
    setSelectedEntityTitle(title);
    setGraphEdges(edges);
    setHistory([]);
    setSheetOpen(true);
  }

  function reanchorEntity(entityId: string) {
    if (!selectedEntityId) return;
    const graphNode = graphRef.current?.getNodeWithEdges(entityId);
    setHistory((current) => [
      ...current,
      { id: selectedEntityId, title: selectedEntityTitle, edges: graphEdges },
    ]);
    setSelectedEntityId(entityId);
    setSelectedEntityTitle(graphNode?.node.label ?? entityId);
    setGraphEdges(graphNode?.edges ?? []);
  }

  if (!effectiveTenantId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading tenant...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <KnowledgeGraphIngestControls
        query={threadQuery}
        candidates={candidates}
        selectedThreadId={selectedThreadId}
        fetching={threadResult.fetching && !threadResult.data}
        error={threadResult.error?.message ?? null}
        ingesting={ingestState.fetching}
        onQueryChange={setThreadQuery}
        onSelectThread={(thread: ThreadCandidate) =>
          setSelectedThreadId(thread.threadId)
        }
        onIngest={() => void ingestSelectedThread()}
      />

      {selectedThreadId ? (
        <KnowledgeGraphRunBanner
          runs={runs}
          fetching={runsResult.fetching}
          error={runsResult.error?.message ?? null}
        />
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="relative w-fit min-w-56 max-w-full">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) =>
              event.key === "Enter" && setActiveSearch(searchQuery.trim())
            }
            className="pl-9"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setActiveSearch("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear entity search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <select
          value={ontologyType}
          onChange={(event) => setOntologyType(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Ontology type"
        >
          <option value="">All types</option>
          {typeOptions.map(([slug, label]) => (
            <option key={slug} value={slug}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={groundingStatus}
          onChange={(event) => setGroundingStatus(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Grounding status"
        >
          <option value="">All grounding</option>
          <option value={KnowledgeGraphGroundingStatus.Grounded}>
            Grounded
          </option>
          <option value={KnowledgeGraphGroundingStatus.Ungrounded}>
            Ungrounded
          </option>
          <option value={KnowledgeGraphGroundingStatus.UnapprovedType}>
            Unapproved type
          </option>
          <option value={KnowledgeGraphGroundingStatus.Conflict}>
            Conflict
          </option>
          <option value={KnowledgeGraphGroundingStatus.Unknown}>Unknown</option>
        </select>

        <select
          value={provenanceStatus}
          onChange={(event) => setProvenanceStatus(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Provenance status"
        >
          <option value="">All provenance</option>
          <option value={KnowledgeGraphProvenanceStatus.Strong}>Strong</option>
          <option value={KnowledgeGraphProvenanceStatus.Weak}>Weak</option>
          <option value={KnowledgeGraphProvenanceStatus.Missing}>
            Missing
          </option>
        </select>

        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => value && setView(value as ExplorerView)}
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
        {!selectedThreadId ? (
          <EmptyState text="Select a thread to inspect its graph." />
        ) : view === "graph" ? (
          <div className="relative h-full overflow-hidden rounded-lg border border-border">
            <KnowledgeGraph
              ref={graphRef}
              tenantId={effectiveTenantId}
              threadId={selectedThreadId}
              searchQuery={activeSearch || undefined}
              typeFilter={ontologyType ? [ontologyType] : undefined}
              groundingStatusFilter={
                groundingFilter ? [groundingFilter] : undefined
              }
              provenanceStatusFilter={
                provenanceFilter ? [provenanceFilter] : undefined
              }
              onNodeClick={(node: KnowledgeGraphNode, edges) => {
                openEntity(node.entityId, node.label, edges);
              }}
            />
          </div>
        ) : loadingEntities ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading entities...
          </div>
        ) : entityResult.error ? (
          <EmptyState text={entityResult.error.message} destructive />
        ) : rows.length === 0 ? (
          <EmptyState
            text={
              selectedThread
                ? "No entities match this thread and filter set."
                : "No selected thread."
            }
          />
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            onRowClick={(row) => openEntity(row.id, row.label)}
            scrollable
            allowHorizontalScroll={false}
            pageSize={25}
            tableClassName="table-fixed"
          />
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex flex-col sm:max-w-lg">
          {selectedEntityId ? (
            <KnowledgeGraphEntitySheet
              tenantId={effectiveTenantId}
              entityId={selectedEntityId}
              title={selectedEntityTitle}
              connectedEdges={graphEdges}
              historyDepth={history.length}
              onBack={() => {
                const previous = history[history.length - 1];
                if (!previous) return;
                setHistory((current) => current.slice(0, -1));
                setSelectedEntityId(previous.id);
                setSelectedEntityTitle(previous.title);
                setGraphEdges(previous.edges);
              }}
              onNeighborClick={reanchorEntity}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TrustBadge({
  groundingStatus,
  provenanceStatus,
}: {
  groundingStatus: string;
  provenanceStatus: string;
}) {
  const weak = provenanceStatus !== KnowledgeGraphProvenanceStatus.Strong;
  const diagnostic =
    !weak && groundingStatus !== KnowledgeGraphGroundingStatus.Grounded;
  return (
    <Badge
      variant={diagnostic ? "secondary" : weak ? "outline" : "default"}
      className="font-normal"
    >
      {weak ? "weak" : diagnostic ? "diagnostic" : "trusted"}
    </Badge>
  );
}

function EmptyState({
  text,
  destructive = false,
}: {
  text: string;
  destructive?: boolean;
}) {
  return (
    <div
      className={`flex h-full items-center justify-center py-12 text-sm ${
        destructive ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {text}
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
