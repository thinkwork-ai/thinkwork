import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
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
  KnowledgeGraphSourceKind,
  type SettingsKnowledgeGraphEntitiesQuery as SettingsKnowledgeGraphEntitiesData,
  type SettingsKnowledgeGraphThreadCandidatesQuery as SettingsKnowledgeGraphThreadCandidatesData,
} from "@/gql/graphql";
import {
  SettingsKnowledgeGraphEntitiesQuery,
  SettingsKnowledgeGraphSourceIngestCapabilityQuery,
  SettingsStartKnowledgeGraphIngestMutation,
  SettingsKnowledgeGraphThreadCandidatesQuery,
  SettingsStartKnowledgeGraphThreadIngestMutation,
} from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import { KnowledgeGraphEntitySheet } from "./KnowledgeGraphEntitySheet";
import { KnowledgeGraphIngestControls } from "./KnowledgeGraphIngestControls";

type ExplorerView = "table" | "graph";
type EntityRow =
  SettingsKnowledgeGraphEntitiesData["knowledgeGraphEntities"][number];
type ThreadCandidate =
  SettingsKnowledgeGraphThreadCandidatesData["knowledgeGraphThreadCandidates"][number];
type IngestRun = NonNullable<ThreadCandidate["lastIngestRun"]>;

const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

interface DropDiagnostics {
  cogneeNodeCount: number;
  cogneeEdgeCount: number;
  droppedNodeCount: number;
  droppedEdgeCount: number;
  structuralNodeCount: number;
  unapprovedNodeCount: number;
  orphanRelationshipCount: number;
  unapprovedRelationshipCount: number;
  incompatibleRelationshipCount: number;
  droppedNodeSamples: DroppedNodeSample[];
  droppedEdgeSamples: DroppedEdgeSample[];
}

interface DroppedNodeSample {
  id: string;
  label: string;
  rawType: string | null;
  dropReason: string;
  propertyKeys: string[];
}

interface DroppedEdgeSample {
  id: string | null;
  label: string;
  rawType: string | null;
  sourceId: string;
  sourceLabel: string | null;
  targetId: string;
  targetLabel: string | null;
  dropReason: string;
  propertyKeys: string[];
}

export function KnowledgeGraphExplorer({
  threadSheetOpen,
  onThreadSheetOpenChange,
}: {
  threadSheetOpen: boolean;
  onThreadSheetOpenChange: (open: boolean) => void;
}) {
  const { tenantId } = useTenant();
  const effectiveTenantId = tenantId ?? null;
  const [view, setView] = useState<ExplorerView>("table");
  const [threadQuery, setThreadQuery] = useState("");
  const [selectedThread, setSelectedThread] = useState<ThreadCandidate | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [ontologyType, setOntologyType] = useState("");
  const [groundingStatus, setGroundingStatus] = useState("");
  const [provenanceStatus, setProvenanceStatus] = useState("");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEntityTitle, setSelectedEntityTitle] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<IngestRun | null>(null);
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
      limit: 50,
    },
    pause: !effectiveTenantId,
  });

  const candidates = threadResult.data?.knowledgeGraphThreadCandidates ?? [];

  const groundingFilter = groundingStatus
    ? (groundingStatus as KnowledgeGraphGroundingStatus)
    : null;
  const provenanceFilter = provenanceStatus
    ? (provenanceStatus as KnowledgeGraphProvenanceStatus)
    : null;

  const entityVariables = {
    tenantId: effectiveTenantId ?? "",
    threadId: null,
    runId: null,
    search: activeSearch || null,
    ontologyType: ontologyType || null,
    groundingStatus: groundingFilter,
    provenanceStatus: provenanceFilter,
    limit: 500,
  };

  const [entityResult, refetchEntities] = useQuery({
    query: SettingsKnowledgeGraphEntitiesQuery,
    variables: entityVariables,
    pause: !effectiveTenantId,
  });

  const [runEntityResult] = useQuery({
    query: SettingsKnowledgeGraphEntitiesQuery,
    variables: {
      tenantId: effectiveTenantId ?? "",
      threadId: null,
      runId: selectedRun?.id ?? null,
      search: null,
      ontologyType: null,
      groundingStatus: null,
      provenanceStatus: null,
      limit: 500,
    },
    pause: !effectiveTenantId || !selectedRun,
  });

  const [sourceCapabilityResult] = useQuery({
    query: SettingsKnowledgeGraphSourceIngestCapabilityQuery,
    pause: !effectiveTenantId,
  });
  const sourceIngestSupported =
    sourceCapabilityResult.data?.__type?.name ===
    "StartKnowledgeGraphIngestInput";

  const [ingestState, startIngest] = useMutation(
    SettingsStartKnowledgeGraphThreadIngestMutation,
  );
  const [sourceIngestState, startSourceIngest] = useMutation(
    SettingsStartKnowledgeGraphIngestMutation,
  );

  const rows = entityResult.data?.knowledgeGraphEntities ?? [];
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

  async function ingestThread(thread: ThreadCandidate) {
    if (!effectiveTenantId) return;
    setSelectedThread(thread);
    const result = await startIngest({
      input: {
        tenantId: effectiveTenantId,
        threadId: thread.threadId,
        force: true,
      },
    });
    if (result.error) {
      toast.error(`Could not start ingest: ${result.error.message}`);
      return;
    }

    toast.success("Knowledge Graph ingest queued");
    const run = result.data?.startKnowledgeGraphThreadIngest;
    if (run) {
      setSelectedRun(run as IngestRun);
    }
    refetchEntities({ requestPolicy: "network-only" });
    refetchThreads({ requestPolicy: "network-only" });
    graphRef.current?.refetch();
  }

  async function ingestSource(sourceKind: KnowledgeGraphSourceKind) {
    if (!effectiveTenantId) return;
    if (!sourceIngestSupported) {
      toast.warning(
        "Wiki and Brain ingest will be available after API deploy.",
      );
      return;
    }
    const result = await startSourceIngest({
      input: {
        tenantId: effectiveTenantId,
        sourceKind,
        force: true,
      },
    });
    if (result.error) {
      toast.error(
        `Could not start ${sourceKind.toLowerCase()} ingest: ${result.error.message}`,
      );
      return;
    }
    toast.success(`${sourceKind.toLowerCase()} Knowledge Graph ingest queued`);
    const run = result.data?.startKnowledgeGraphIngest;
    if (run) {
      setSelectedRun(run as IngestRun);
    }
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

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={sourceIngestState.fetching || !sourceIngestSupported}
          title={
            sourceIngestSupported
              ? "Ingest wiki source"
              : "Available after API deploy"
          }
          onClick={() => void ingestSource(KnowledgeGraphSourceKind.Wiki)}
        >
          {sourceIngestState.fetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <BookOpen className="size-4" />
          )}
          Wiki
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={sourceIngestState.fetching || !sourceIngestSupported}
          title={
            sourceIngestSupported
              ? "Ingest Company Brain source"
              : "Available after API deploy"
          }
          onClick={() => void ingestSource(KnowledgeGraphSourceKind.Brain)}
        >
          {sourceIngestState.fetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Brain className="size-4" />
          )}
          Brain
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {view === "graph" ? (
          <div className="relative h-full overflow-hidden rounded-lg border border-border">
            <KnowledgeGraph
              ref={graphRef}
              tenantId={effectiveTenantId}
              threadId={null}
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
          <EmptyState text="No known ontology entities match this filter set." />
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

      <Sheet open={threadSheetOpen} onOpenChange={onThreadSheetOpenChange}>
        <SheetContent className="flex flex-col gap-4 sm:max-w-3xl">
          <SheetHeader className="border-b border-border/70 px-6 py-4 pr-14">
            <SheetTitle>
              {selectedThread ? "Thread Detail" : "Thread Ingest"}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {selectedThread ? (
              <ThreadIngestDetailView
                tenantId={effectiveTenantId}
                run={selectedRun ?? selectedThread.lastIngestRun ?? null}
                thread={selectedThread}
                entities={runEntityResult.data?.knowledgeGraphEntities ?? []}
                fetching={runEntityResult.fetching}
                error={runEntityResult.error?.message ?? null}
                ingesting={ingestState.fetching}
                onBack={() => {
                  setSelectedThread(null);
                  setSelectedRun(null);
                }}
                onIngest={() => void ingestThread(selectedThread)}
                onEntityClick={(entity) => openEntity(entity.id, entity.label)}
              />
            ) : (
              <div className="grid gap-4">
                <KnowledgeGraphIngestControls
                  query={threadQuery}
                  candidates={candidates}
                  fetching={threadResult.fetching && !threadResult.data}
                  error={threadResult.error?.message ?? null}
                  onQueryChange={setThreadQuery}
                  onSelectThread={(thread: ThreadCandidate) => {
                    setSelectedThread(thread);
                    setSelectedRun(thread.lastIngestRun ?? null);
                  }}
                />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

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

function ThreadIngestDetailView({
  tenantId,
  run,
  thread,
  entities,
  fetching,
  error,
  ingesting,
  onBack,
  onIngest,
  onEntityClick,
}: {
  tenantId: string;
  run: IngestRun | null;
  thread: ThreadCandidate;
  entities: EntityRow[];
  fetching: boolean;
  error?: string | null;
  ingesting: boolean;
  onBack: () => void;
  onIngest: () => void;
  onEntityClick: (entity: Pick<EntityRow, "id" | "label">) => void;
}) {
  const columns: ColumnDef<EntityRow>[] = [
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
      size: 128,
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
      accessorKey: "relationshipCount",
      header: "Links",
      size: 72,
      cell: ({ row }) => (
        <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
          {row.original.relationshipCount}
        </span>
      ),
    },
    {
      accessorKey: "evidenceCount",
      header: "Evidence",
      size: 92,
      cell: ({ row }) => (
        <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
          {row.original.evidenceCount}
        </span>
      ),
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit px-0"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
          Threads
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={ingesting}
          onClick={onIngest}
        >
          {ingesting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Ingest thread
        </Button>
      </div>

      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {run ? (
            <Badge variant={runStatusVariant(run.status)}>
              {formatRunStatus(run.status)}
            </Badge>
          ) : (
            <Badge variant="secondary">not ingested</Badge>
          )}
          <span className="min-w-0 truncate text-sm font-medium">
            #{thread.number} {thread.title}
          </span>
          {run?.durationMs != null ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {run.durationMs} ms
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{run?.entityCount ?? 0} entities</span>
          <span>{run?.relationshipCount ?? 0} links</span>
          <span>{run?.evidenceCount ?? 0} evidence</span>
          <span>{run?.messageCount ?? thread.messageCount} messages</span>
        </div>
        {run?.error ? (
          <p className="mt-2 text-sm text-destructive">{run.error}</p>
        ) : null}
      </div>

      <div className="min-h-48">
        {!run ? (
          <EmptyState text="This thread has not been ingested yet." />
        ) : fetching && entities.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading results...
          </div>
        ) : error ? (
          <EmptyState text={error} destructive />
        ) : (
          <DataTable
            columns={columns}
            data={entities}
            onRowClick={onEntityClick}
            pageSize={0}
            allowHorizontalScroll={false}
            tableClassName="table-fixed"
            emptyState="No known ontology entities were stored for this ingest."
          />
        )}
      </div>

      {run ? (
        <>
          {shouldShowDropDiagnostics(run, entities) ? (
            <IngestDropDiagnostics
              metrics={parseDropDiagnostics(run.metrics)}
            />
          ) : null}
        </>
      ) : null}

      {run ? (
        <div className="h-80 overflow-hidden rounded-lg border border-border">
          <KnowledgeGraph
            tenantId={tenantId}
            threadId={null}
            runId={run.id}
            onNodeClick={(node: KnowledgeGraphNode) => {
              onEntityClick({ id: node.entityId, label: node.label });
            }}
            emptyFallback={
              <EmptyState text="No known ontology graph was stored for this ingest." />
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function shouldShowDropDiagnostics(run: IngestRun, entities: EntityRow[]) {
  const metrics = parseDropDiagnostics(run.metrics);
  return run.entityCount === 0 && entities.length === 0 && metrics !== null;
}

function IngestDropDiagnostics({
  metrics,
}: {
  metrics: DropDiagnostics | null;
}) {
  if (!metrics) return null;

  const hasRawGraph =
    metrics.cogneeNodeCount > 0 || metrics.cogneeEdgeCount > 0;
  const nodeRows = metrics.droppedNodeSamples;
  const edgeRows = metrics.droppedEdgeSamples;

  return (
    <div className="grid gap-3 rounded-md border border-border bg-card p-3">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Ontology gate diagnostics</p>
        <p className="text-xs leading-5 text-muted-foreground">
          {hasRawGraph
            ? `Cognee returned ${metrics.cogneeNodeCount} raw nodes and ${metrics.cogneeEdgeCount} raw links, but none became approved ThinkWork ontology entities.`
            : "Cognee did not return a raw graph for this ingest."}
        </p>
      </div>

      {hasRawGraph ? (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <MetricPill
            label="Unapproved nodes"
            value={metrics.unapprovedNodeCount}
          />
          <MetricPill
            label="Structural nodes"
            value={metrics.structuralNodeCount}
          />
          <MetricPill
            label="Orphan links"
            value={metrics.orphanRelationshipCount}
          />
          <MetricPill
            label="Rejected links"
            value={
              metrics.unapprovedRelationshipCount +
              metrics.incompatibleRelationshipCount
            }
          />
        </div>
      ) : null}

      {nodeRows.length ? (
        <DiagnosticSampleTable
          title="Dropped nodes"
          rows={nodeRows.map((node) => ({
            id: node.id,
            primary: node.label,
            secondary: node.rawType ?? "unknown type",
            reason: formatDropReason(node.dropReason),
            properties: node.propertyKeys.join(", "),
          }))}
        />
      ) : null}

      {edgeRows.length ? (
        <DiagnosticSampleTable
          title="Dropped links"
          rows={edgeRows.map((edge) => ({
            id: edge.id ?? `${edge.sourceId}-${edge.targetId}-${edge.label}`,
            primary: `${edge.sourceLabel ?? edge.sourceId} -> ${
              edge.targetLabel ?? edge.targetId
            }`,
            secondary: edge.rawType ?? edge.label,
            reason: formatDropReason(edge.dropReason),
            properties: edge.propertyKeys.join(", "),
          }))}
        />
      ) : null}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 px-2 py-1">
      <div className="truncate text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function DiagnosticSampleTable({
  title,
  rows,
}: {
  title: string;
  rows: {
    id: string;
    primary: string;
    secondary: string;
    reason: string;
    properties: string;
  }[];
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border/70">
      <div className="border-b border-border/70 px-2 py-1.5 text-xs font-medium">
        {title}
      </div>
      <div className="divide-y divide-border/70">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid min-w-0 grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-2 px-2 py-2 text-xs"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{row.primary}</div>
              <div className="truncate text-muted-foreground">
                {row.properties || "no properties"}
              </div>
            </div>
            <div className="min-w-0 truncate text-muted-foreground">
              {row.secondary}
            </div>
            <div className="min-w-0 truncate">{row.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseDropDiagnostics(value: unknown): DropDiagnostics | null {
  const record = parseJsonRecord(value);
  if (!record) return null;
  const metrics = {
    cogneeNodeCount: readMetricNumber(record.cogneeNodeCount),
    cogneeEdgeCount: readMetricNumber(record.cogneeEdgeCount),
    droppedNodeCount: readMetricNumber(record.droppedNodeCount),
    droppedEdgeCount: readMetricNumber(record.droppedEdgeCount),
    structuralNodeCount: readMetricNumber(record.structuralNodeCount),
    unapprovedNodeCount: readMetricNumber(record.unapprovedNodeCount),
    orphanRelationshipCount: readMetricNumber(record.orphanRelationshipCount),
    unapprovedRelationshipCount: readMetricNumber(
      record.unapprovedRelationshipCount,
    ),
    incompatibleRelationshipCount: readMetricNumber(
      record.incompatibleRelationshipCount,
    ),
    droppedNodeSamples: readDroppedNodeSamples(record.droppedNodeSamples),
    droppedEdgeSamples: readDroppedEdgeSamples(record.droppedEdgeSamples),
  } satisfies DropDiagnostics;

  if (
    metrics.cogneeNodeCount === 0 &&
    metrics.cogneeEdgeCount === 0 &&
    metrics.droppedNodeCount === 0 &&
    metrics.droppedEdgeCount === 0
  ) {
    return null;
  }
  return metrics;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function readDroppedNodeSamples(value: unknown): DroppedNodeSample[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, 12)
    .map((node) => ({
      id: readString(node.id, "unknown-node"),
      label: readString(node.label, "Unknown node"),
      rawType: readNullableString(node.rawType),
      dropReason: readString(node.dropReason, "unknown"),
      propertyKeys: readStringArray(node.propertyKeys),
    }));
}

function readDroppedEdgeSamples(value: unknown): DroppedEdgeSample[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, 12)
    .map((edge) => ({
      id: readNullableString(edge.id),
      label: readString(edge.label, "unknown link"),
      rawType: readNullableString(edge.rawType),
      sourceId: readString(edge.sourceId, "unknown-source"),
      sourceLabel: readNullableString(edge.sourceLabel),
      targetId: readString(edge.targetId, "unknown-target"),
      targetLabel: readNullableString(edge.targetLabel),
      dropReason: readString(edge.dropReason, "unknown"),
      propertyKeys: readStringArray(edge.propertyKeys),
    }));
}

function readMetricNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatDropReason(value: string) {
  return value.replace(/_/g, " ");
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

function formatRunStatus(status: string) {
  return status.toLowerCase().replace(/_/g, " ");
}

function runStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" {
  if (status === "FAILED") return "destructive";
  if (status === "SUCCEEDED") return "default";
  return "secondary";
}
