import { useMemo, useRef, useState } from "react";
import { useQuery } from "urql";
import { Loader2, Search, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
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
  type SettingsKnowledgeGraphOntologyQuery as SettingsKnowledgeGraphOntologyData,
} from "@/gql/graphql";
import {
  SettingsKnowledgeGraphEntitiesQuery,
  SettingsKnowledgeGraphOntologyQuery,
} from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import { KnowledgeGraphEntitySheet } from "./KnowledgeGraphEntitySheet";

type ExplorerView = "table" | "graph";
type ExplorerMode = "data" | "definitions";
type OntologyView = "entities" | "relationships" | "mappings";
type EntityRow =
  SettingsKnowledgeGraphEntitiesData["knowledgeGraphEntities"][number];
type OntologyDefinitions =
  SettingsKnowledgeGraphOntologyData["ontologyDefinitions"];

const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";
// Definition tables use auto table layout (no fixed pixel widths). The leading
// identity column hugs its content; the remaining columns absorb the leftover
// width and truncate so the table never overflows horizontally. These are driven
// by per-column `meta` class overrides applied to the <th>/<td> by DataTable.
// Headers use px-4 so they line up with cell content, which is double-padded
// (the <td>'s own p-2 plus COMPACT_TABLE_CELL's inner px-2 = 16px).
const FIT_COLUMN_META = {
  meta: { cellClassName: "w-px whitespace-nowrap", headClassName: "w-px px-4" },
};
const TRUNCATE_COLUMN_META = {
  meta: { cellClassName: "max-w-0", headClassName: "px-4" },
};
// Header padding that lines a column's <th> up with its double-padded cell
// content (the <td>'s p-2 plus COMPACT_TABLE_CELL's inner px-2 = 16px). Used by
// the fixed-width Data and Thread Ingest tables, which keep their own sizing.
const HEADER_PAD_META = { meta: { headClassName: "px-4" } };
// Center variant for compact columns (badges / counts). Pair with
// `justify-center` on the cell wrapper so header and content both center.
const CENTER_COLUMN_META = { meta: { headClassName: "px-4 text-center" } };
const CENTER_TABLE_CELL = `${COMPACT_TABLE_CELL} justify-center`;

export function KnowledgeGraphExplorer({ mode }: { mode: ExplorerMode }) {
  const { tenantId } = useTenant();
  const effectiveTenantId = tenantId ?? null;
  const dataMode = mode === "data";
  const [view, setView] = useState<ExplorerView>("table");
  const [ontologyView, setOntologyView] = useState<OntologyView>("entities");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [definitionsQuery, setDefinitionsQuery] = useState("");
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

  const entityVariables = {
    tenantId: effectiveTenantId ?? "",
    threadId: null,
    runId: null,
    search: activeSearch || null,
    ontologyType: null,
    groundingStatus: null,
    provenanceStatus: null,
    limit: 500,
  };

  const [entityResult] = useQuery({
    query: SettingsKnowledgeGraphEntitiesQuery,
    variables: entityVariables,
    pause: !dataMode || !effectiveTenantId,
  });

  const [ontologyResult] = useQuery({
    query: SettingsKnowledgeGraphOntologyQuery,
    variables: { tenantId: effectiveTenantId ?? "" },
    pause: !effectiveTenantId,
  });

  const rows = entityResult.data?.knowledgeGraphEntities ?? [];
  const loadingEntities = entityResult.fetching && !entityResult.data;

  const columns: ColumnDef<EntityRow>[] = useMemo(
    () => [
      {
        accessorKey: "label",
        header: "Entity",
        ...HEADER_PAD_META,
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
        ...CENTER_COLUMN_META,
        cell: ({ row }) => (
          <span className={CENTER_TABLE_CELL}>
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
        size: 88,
        ...CENTER_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${CENTER_TABLE_CELL} text-muted-foreground`}>
            {row.original.relationshipCount}
          </span>
        ),
      },
      {
        accessorKey: "evidenceCount",
        header: "Evidence",
        size: 104,
        ...CENTER_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${CENTER_TABLE_CELL} text-muted-foreground`}>
            {row.original.evidenceCount}
          </span>
        ),
      },
      {
        accessorKey: "lastSeenAt",
        header: "Last seen",
        size: 132,
        ...HEADER_PAD_META,
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

  const ontologyDefinitions = ontologyResult.data?.ontologyDefinitions ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {mode === "data" ? (
          <>
            <ToolbarSearch
              value={searchQuery}
              placeholder="Search entities..."
              clearLabel="Clear entity search"
              onChange={setSearchQuery}
              onCommit={() => setActiveSearch(searchQuery.trim())}
              onClear={() => {
                setSearchQuery("");
                setActiveSearch("");
              }}
            />
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => value && setView(value as ExplorerView)}
              variant="outline"
            >
              <ToggleGroupItem value="table" className="px-3 text-xs">
                Table
              </ToggleGroupItem>
              <ToggleGroupItem value="graph" className="px-3 text-xs">
                Graph
              </ToggleGroupItem>
            </ToggleGroup>
          </>
        ) : (
          <>
            <ToolbarSearch
              value={definitionsQuery}
              placeholder="Search definitions..."
              clearLabel="Clear definitions search"
              onChange={setDefinitionsQuery}
              onClear={() => setDefinitionsQuery("")}
            />
            <ToggleGroup
              type="single"
              value={ontologyView}
              onValueChange={(value) =>
                value && setOntologyView(value as OntologyView)
              }
              variant="outline"
            >
              <ToggleGroupItem value="entities" className="px-3 text-xs">
                Entities
              </ToggleGroupItem>
              <ToggleGroupItem value="relationships" className="px-3 text-xs">
                Links
              </ToggleGroupItem>
              <ToggleGroupItem value="mappings" className="px-3 text-xs">
                Maps
              </ToggleGroupItem>
            </ToggleGroup>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {mode === "definitions" ? (
          <OntologyDefinitionsTable
            definitions={ontologyDefinitions}
            fetching={ontologyResult.fetching && !ontologyResult.data}
            error={ontologyResult.error?.message ?? null}
            view={ontologyView}
            query={definitionsQuery}
          />
        ) : (
          <>
            {view === "graph" ? (
              <div className="relative h-full overflow-hidden rounded-lg border border-border">
                <KnowledgeGraph
                  ref={graphRef}
                  tenantId={effectiveTenantId}
                  threadId={null}
                  searchQuery={activeSearch || undefined}
                  onNodeClick={(node: KnowledgeGraphNode, edges) => {
                    openEntity(node.entityId, node.label, edges);
                  }}
                />
              </div>
            ) : loadingEntities ? (
              <div className="flex h-full items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading entities...
              </div>
            ) : entityResult.error ? (
              <EmptyState text={entityResult.error.message} destructive />
            ) : rows.length === 0 ? (
              <EmptyState text="No known ontology entities yet." />
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
          </>
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

type EntityTypeRow = NonNullable<OntologyDefinitions>["entityTypes"][number];
type RelationshipTypeRow =
  NonNullable<OntologyDefinitions>["relationshipTypes"][number];
type ExternalMappingRow =
  NonNullable<OntologyDefinitions>["externalMappings"][number];

function ToolbarSearch({
  value,
  placeholder,
  clearLabel,
  onChange,
  onCommit,
  onClear,
}: {
  value: string;
  placeholder: string;
  clearLabel: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  onClear: () => void;
}) {
  return (
    <div className="relative w-fit min-w-56 max-w-full">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={
          onCommit ? (event) => event.key === "Enter" && onCommit() : undefined
        }
        className="pl-9"
      />
      {value ? (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={clearLabel}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function matchesQuery(haystack: (string | null | undefined)[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.some((value) => (value ?? "").toLowerCase().includes(needle));
}

function definitionsEmptyState(
  total: number,
  query: string,
  emptyMessage: string,
) {
  if (total === 0) return emptyMessage;
  return query.trim() ? "No definitions match your search." : emptyMessage;
}

function OntologyDefinitionsTable({
  definitions,
  fetching,
  error,
  view,
  query,
}: {
  definitions: OntologyDefinitions | null;
  fetching: boolean;
  error?: string | null;
  view: OntologyView;
  query: string;
}) {
  const entityTypes = definitions?.entityTypes ?? [];
  const relationshipTypes = definitions?.relationshipTypes ?? [];
  const mappings = definitions?.externalMappings ?? [];
  const subjectLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const entity of entityTypes) {
      labels.set(`entity_type:${entity.id}`, entity.name);
    }
    for (const relationship of relationshipTypes) {
      labels.set(`relationship_type:${relationship.id}`, relationship.name);
    }
    return labels;
  }, [entityTypes, relationshipTypes]);

  if (fetching) {
    return (
      <div className="flex h-full items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading ontology...
      </div>
    );
  }
  if (error) {
    return <EmptyState text={error} destructive />;
  }
  if (view === "entities") {
    return <EntityDefinitionsTable rows={entityTypes} query={query} />;
  }
  if (view === "relationships") {
    return (
      <RelationshipDefinitionsTable rows={relationshipTypes} query={query} />
    );
  }
  return (
    <MappingDefinitionsTable
      rows={mappings}
      subjectLabels={subjectLabels}
      query={query}
    />
  );
}

function EntityDefinitionsTable({
  rows,
  query,
}: {
  rows: EntityTypeRow[];
  query: string;
}) {
  const filtered = useMemo(
    () =>
      rows.filter((entity) =>
        matchesQuery(
          [entity.name, entity.slug, entity.description, ...entity.aliases],
          query,
        ),
      ),
    [rows, query],
  );
  const columns: ColumnDef<EntityTypeRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        ...FIT_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} font-medium`}>
            <span className="whitespace-nowrap">{row.original.name}</span>
          </span>
        ),
      },
      {
        accessorKey: "broadType",
        header: "Type",
        ...FIT_COLUMN_META,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <Badge variant="outline" className="font-normal">
              {row.original.broadType}
            </Badge>
          </span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        ...TRUNCATE_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            <span className="truncate">
              {row.original.description || row.original.slug}
            </span>
          </span>
        ),
      },
      {
        id: "aliases",
        header: "Aliases",
        ...TRUNCATE_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            <span className="truncate">
              {row.original.aliases.join(", ") || "—"}
            </span>
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      scrollable
      allowHorizontalScroll={false}
      pageSize={25}
      emptyState={definitionsEmptyState(
        rows.length,
        query,
        "No approved ontology entities are defined.",
      )}
    />
  );
}

function RelationshipDefinitionsTable({
  rows,
  query,
}: {
  rows: RelationshipTypeRow[];
  query: string;
}) {
  const filtered = useMemo(
    () =>
      rows.filter((relationship) =>
        matchesQuery(
          [
            relationship.name,
            ...relationship.sourceTypeSlugs,
            ...relationship.targetTypeSlugs,
            ...relationship.aliases,
          ],
          query,
        ),
      ),
    [rows, query],
  );
  const columns: ColumnDef<RelationshipTypeRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        ...FIT_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} font-medium`}>
            <span className="whitespace-nowrap">{row.original.name}</span>
          </span>
        ),
      },
      {
        id: "source",
        header: "Source",
        ...TRUNCATE_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            <span className="truncate">
              {row.original.sourceTypeSlugs.join(", ") || "any"}
            </span>
          </span>
        ),
      },
      {
        id: "target",
        header: "Target",
        ...TRUNCATE_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            <span className="truncate">
              {row.original.targetTypeSlugs.join(", ") || "any"}
            </span>
          </span>
        ),
      },
      {
        id: "aliases",
        header: "Aliases",
        ...TRUNCATE_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            <span className="truncate">
              {row.original.aliases.join(", ") || "—"}
            </span>
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      scrollable
      allowHorizontalScroll={false}
      pageSize={25}
      emptyState={definitionsEmptyState(
        rows.length,
        query,
        "No approved ontology relationships are defined.",
      )}
    />
  );
}

function MappingDefinitionsTable({
  rows,
  subjectLabels,
  query,
}: {
  rows: ExternalMappingRow[];
  subjectLabels: Map<string, string>;
  query: string;
}) {
  const filtered = useMemo(
    () =>
      rows.filter((mapping) => {
        const subject =
          subjectLabels.get(`${mapping.subjectKind}:${mapping.subjectId}`) ??
          mapping.subjectKind.replace(/_/g, " ");
        return matchesQuery(
          [
            subject,
            mapping.vocabulary,
            mapping.externalLabel,
            mapping.externalUri,
          ],
          query,
        );
      }),
    [rows, subjectLabels, query],
  );
  const columns: ColumnDef<ExternalMappingRow>[] = useMemo(
    () => [
      {
        id: "subject",
        header: "Subject",
        ...FIT_COLUMN_META,
        cell: ({ row }) => {
          const subject =
            subjectLabels.get(
              `${row.original.subjectKind}:${row.original.subjectId}`,
            ) ?? row.original.subjectKind.replace(/_/g, " ");
          return (
            <span className={`${COMPACT_TABLE_CELL} font-medium`}>
              <span className="whitespace-nowrap">{subject}</span>
            </span>
          );
        },
      },
      {
        accessorKey: "mappingKind",
        header: "Kind",
        ...FIT_COLUMN_META,
        cell: ({ row }) => (
          <span className={COMPACT_TABLE_CELL}>
            <Badge variant="outline" className="font-normal">
              {formatEnum(row.original.mappingKind)}
            </Badge>
          </span>
        ),
      },
      {
        accessorKey: "vocabulary",
        header: "Vocabulary",
        ...TRUNCATE_COLUMN_META,
        cell: ({ row }) => (
          <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
            <span className="truncate">
              {row.original.vocabulary}
              {row.original.externalLabel
                ? ` · ${row.original.externalLabel}`
                : ""}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "externalUri",
        header: "External URI",
        ...TRUNCATE_COLUMN_META,
        cell: ({ row }) => (
          <span
            className={`${COMPACT_TABLE_CELL} font-mono text-[11px] text-muted-foreground`}
          >
            <span className="truncate">{row.original.externalUri}</span>
          </span>
        ),
      },
    ],
    [subjectLabels],
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      scrollable
      allowHorizontalScroll={false}
      pageSize={25}
      emptyState={definitionsEmptyState(
        rows.length,
        query,
        "No external vocabulary mappings are defined.",
      )}
    />
  );
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
