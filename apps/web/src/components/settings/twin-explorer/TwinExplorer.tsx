import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClient, useQuery } from "urql";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { useNavigate } from "@tanstack/react-router";
import { Link2, Search, Shapes, Tag, X } from "lucide-react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DataTableTokenFilter,
  Input,
  ToggleGroup,
  ToggleGroupItem,
  dataTableTokenFilterFns,
  isDataTableTokenFilterValue,
  type DataTableTokenFilterColumn,
  type DataTableTokenFilterValue,
} from "@thinkwork/ui";
import {
  TwinGraph,
  TwinNeighborMembersQuery,
  TwinNeighborSummaryQuery,
  mapNeptuneNode,
  type TwinGraphData,
  type TwinGraphLink,
  type TwinGraphNode,
} from "@thinkwork/graph";
import { type TwinSheetSelection } from "./TwinNodeSheet";
import { TwinDetailPanel, TwinStatsPanel } from "./TwinDetailPanel";
import {
  TwinCohortQuery,
  TwinExplorerOntologyQuery,
} from "@/lib/graphql-queries";
import {
  TRAVERSAL_BATCH_SIZE,
  addMembers,
  addRoot,
  buildTraversalGraphData,
  createTraversal,
  groupKey,
  groupKeyFromSyntheticId,
  removeRoot,
  setGroupExpanded,
  setSummary,
  type TraversalState,
  type TraversalSummaryRow,
} from "./TwinTraversal";
import { useTenant } from "@/context/TenantContext";
import { CypherConsole } from "./CypherConsole";
import { TwinMindMap } from "./TwinMindMap";
import {
  parseExplorerFacets,
  type ExplorerFacet,
  type TypedPredicate,
} from "./PredicateBuilder";

const COHORT_LIMIT = 100;

interface ExplorerEntityType {
  slug: string;
  name: string | null;
  lifecycleStatus: string | null;
  twinFacets: unknown;
}

interface ExplorerRelationshipType {
  slug: string;
  name: string | null;
  lifecycleStatus: string | null;
  sourceTypeSlugs: string[] | null;
  targetTypeSlugs: string[] | null;
}

export interface CohortRow {
  canonicalId: string | null;
  label: string;
  properties: Record<string, unknown>;
}

/**
 * Header actions the Explorer publishes for SettingsMemoryHome (the
 * Ontology/KBs controller pattern): the console lives behind a page-header
 * TooltipIconButton, not an in-body button.
 */
export interface TwinExplorerHeaderController {
  consoleOpen: boolean;
  toggleConsole: () => void;
}

function parseAwsJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** `t#<tenant>#e#<canonicalId>` → canonicalId. */
function canonicalIdFromNodeId(nodeId: unknown): string | null {
  if (typeof nodeId !== "string") return null;
  const match = /^t#[^#]+#e#(.+)$/.exec(nodeId);
  return match ? match[1]! : null;
}

/** Cohort envelope → table rows. Returns null when the payload is not ok. */
export function parseTwinCohortRows(payload: unknown): CohortRow[] | null {
  const envelope = parseAwsJson(payload);
  if (!envelope || envelope.ok !== true) return null;
  const results = Array.isArray(envelope.results) ? envelope.results : [];
  return results.flatMap((row) => {
    const node = (row as Record<string, unknown>)?.node;
    if (!node || typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    const properties =
      record["~properties"] && typeof record["~properties"] === "object"
        ? (record["~properties"] as Record<string, unknown>)
        : {};
    const canonicalId = canonicalIdFromNodeId(record["~id"]);
    const displayName = properties.displayName;
    return [
      {
        canonicalId,
        label:
          typeof displayName === "string" && displayName
            ? displayName
            : (canonicalId ?? "(unnamed)"),
        properties,
      },
    ];
  });
}

/** Envelope failure reason, when the payload is a typed non-ok result. */
export function parseTwinCohortFailure(
  payload: unknown,
): { reason: string; detail: string | null } | null {
  const envelope = parseAwsJson(payload);
  if (!envelope || envelope.ok !== false) return null;
  return {
    reason:
      typeof envelope.reason === "string" ? envelope.reason : "unavailable",
    detail: typeof envelope.detail === "string" ? envelope.detail : null,
  };
}

/** `twinNeighborSummary` envelope → traversal ring rows (null when not ok). */
export function parseTwinSummaryRows(
  payload: unknown,
): TraversalSummaryRow[] | null {
  const envelope = parseAwsJson(payload);
  if (!envelope || envelope.ok !== true) return null;
  const results = Array.isArray(envelope.results) ? envelope.results : [];
  return results.flatMap((row) => {
    const record = row as Record<string, unknown>;
    const relationship = record.relationship;
    const direction = record.direction;
    const targetType = record.targetType;
    const count = record.count;
    if (
      typeof relationship !== "string" ||
      (direction !== "in" && direction !== "out") ||
      typeof targetType !== "string" ||
      typeof count !== "number"
    ) {
      return [];
    }
    return [{ relationship, direction, targetType, count }];
  });
}

/** `twinNeighborMembers` envelope → member nodes + edge links (null when not ok). */
export function parseTwinMemberBatch(payload: unknown): {
  nodes: TwinGraphNode[];
  links: TwinGraphLink[];
} | null {
  const envelope = parseAwsJson(payload);
  if (!envelope || envelope.ok !== true) return null;
  const results = Array.isArray(envelope.results) ? envelope.results : [];
  const row = (results[0] ?? {}) as Record<string, unknown>;
  const nodes: TwinGraphNode[] = [];
  for (const member of Array.isArray(row.members) ? row.members : []) {
    const mapped = mapNeptuneNode(member, false);
    if (mapped) nodes.push(mapped);
  }
  const links: TwinGraphLink[] = [];
  const linkIds = new Set<string>();
  for (const edge of Array.isArray(row.edges) ? row.edges : []) {
    if (!edge || typeof edge !== "object") continue;
    const { rel, sourceId, targetId, props } = edge as Record<string, unknown>;
    if (
      typeof rel !== "string" ||
      typeof sourceId !== "string" ||
      typeof targetId !== "string"
    ) {
      continue;
    }
    const id = `${rel}:${sourceId}->${targetId}`;
    if (linkIds.has(id)) continue;
    linkIds.add(id);
    links.push({
      id,
      source: sourceId,
      target: targetId,
      label: rel,
      properties:
        props && typeof props === "object"
          ? (props as Record<string, unknown>)
          : {},
    });
  }
  return { nodes, links };
}

export const ENTITY_TYPE_COLUMN_ID = "entityType";
export const PATH_COLUMN_ID = "relatedTo";
const ATTR_PREFIX = "attr:";

const NUMBER_OPERATOR_TO_OP: Record<string, TypedPredicate["op"]> = {
  is: "eq",
  is_not: "ne",
  greater_than: "gt",
  greater_or_equal: "gte",
  less_than: "lt",
  less_or_equal: "lte",
};

export interface ExplorerFilterModel {
  entityTypes: string[];
  predicates: TypedPredicate[];
  path: { relationship: string; targetType: string; predicates: [] } | null;
  errors: string[];
}

function singleStringValue(value: DataTableTokenFilterValue): string | null {
  const raw = Array.isArray(value.value) ? value.value[0] : value.value;
  return typeof raw === "string" && raw ? raw : null;
}

function stringValues(value: DataTableTokenFilterValue): string[] {
  const raw = Array.isArray(value.value) ? value.value : [value.value];
  return raw.filter(
    (entry): entry is string => typeof entry === "string" && entry !== "",
  );
}

/**
 * Compile the standard token-filter state into the typed cohort filter
 * (KTD-5 grammar): entity type + facet-attribute predicates + optional
 * declared-relationship path. Values are typed by the governed
 * declaration's filterType, so numbers go out as JSON numbers (R2).
 */
export function buildExplorerFilterModel(
  columnFilters: ColumnFiltersState,
  facets: ExplorerFacet[],
  relationships: Array<{
    slug: string;
    targetTypeSlugs?: string[] | null;
  }>,
): ExplorerFilterModel {
  let entityTypes: string[] = [];
  let path: ExplorerFilterModel["path"] = null;
  const predicates: TypedPredicate[] = [];
  const errors: string[] = [];

  for (const filter of columnFilters) {
    if (!isDataTableTokenFilterValue(filter.value)) continue;
    const value = filter.value;
    if (filter.id === ENTITY_TYPE_COLUMN_ID) {
      entityTypes = stringValues(value);
      continue;
    }
    if (filter.id === PATH_COLUMN_ID) {
      const relationshipSlug = singleStringValue(value);
      const relationship = relationships.find(
        (rel) => rel.slug === relationshipSlug,
      );
      const targetType = relationship?.targetTypeSlugs?.[0];
      if (relationship && targetType) {
        path = { relationship: relationship.slug, targetType, predicates: [] };
      }
      continue;
    }
    if (!filter.id.startsWith(ATTR_PREFIX)) continue;
    const [facetSlug, attributeName] = filter.id
      .slice(ATTR_PREFIX.length)
      .split(".", 2);
    const attribute = facets
      .find((facet) => facet.slug === facetSlug)
      ?.attributes.find((a) => a.attribute === attributeName);
    if (!facetSlug || !attributeName || !attribute) continue;

    if (attribute.filterType === "number") {
      const op = NUMBER_OPERATOR_TO_OP[value.operator];
      const numeric = Number(
        Array.isArray(value.value) ? value.value[0] : value.value,
      );
      if (!op || !Number.isFinite(numeric)) {
        errors.push(`${facetSlug}.${attributeName}: enter a number`);
        continue;
      }
      predicates.push({
        facet: facetSlug,
        attribute: attributeName,
        op,
        value: numeric,
      });
      continue;
    }
    if (attribute.filterType === "boolean") {
      const raw = Array.isArray(value.value) ? value.value[0] : value.value;
      predicates.push({
        facet: facetSlug,
        attribute: attributeName,
        op: value.operator === "is_not" ? "ne" : "eq",
        value: raw === true || raw === "true",
      });
      continue;
    }
    const text = singleStringValue(value);
    if (text) {
      predicates.push({
        facet: facetSlug,
        attribute: attributeName,
        op: "contains",
        value: text,
      });
    }
  }

  return { entityTypes, predicates, path, errors };
}

/**
 * Server-backed entity search picker (traversal entry, KTD-7). Typing
 * fires debounced `twinCohort` queries with `nameContains` across the
 * searchable types — results come from the SERVER, capped per type; the
 * twin's thousands of entities are never loaded into the popover. Picking
 * a result roots a traversal on that entity (customer, person, any type).
 */
export function TwinEntitySearchPicker({
  tenantId,
  typeSlugs,
  typeNameBySlug,
  onPick,
  onClose,
}: {
  tenantId: string;
  typeSlugs: string[];
  typeNameBySlug: Map<string, string>;
  onPick: (node: TwinGraphNode) => void;
  onClose: () => void;
}) {
  const client = useClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<
    CohortRow & { entityTypeSlug: string }
  > | null>(null);
  const [searching, setSearching] = useState(false);
  const genRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      genRef.current += 1;
      setResults(null);
      setSearching(false);
      return;
    }
    const generation = ++genRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      void Promise.all(
        typeSlugs.map((entityType) =>
          client
            .query(TwinCohortQuery, {
              tenantId,
              entityType,
              filter: JSON.stringify({
                predicates: [],
                nameContains: trimmed,
              }),
              limit: 10,
            })
            .toPromise()
            .then((result) => ({
              entityType,
              rows:
                parseTwinCohortRows(
                  (result.data as { twinCohort?: unknown } | undefined)
                    ?.twinCohort,
                ) ?? [],
            })),
        ),
      ).then((parts) => {
        if (generation !== genRef.current) return;
        const merged = parts.flatMap((part) =>
          part.rows
            .filter((row) => row.canonicalId)
            .map((row) => ({ ...row, entityTypeSlug: part.entityType })),
        );
        merged.sort((a, b) => a.label.localeCompare(b.label));
        setResults(merged.slice(0, 20));
        setSearching(false);
      });
    }, 300);
    return () => clearTimeout(timer);
    // `client` is render-stable from the urql Provider — kept out of the
    // deps so test doubles can't loop the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tenantId, typeSlugs.join(",")]);

  return (
    <div className="relative flex h-8 w-[min(20rem,calc(100vw-2rem))] items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        autoFocus
        type="search"
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        placeholder="Find an entity..."
        aria-label="Find an entity"
        data-testid="traversal-entity-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <button
        type="button"
        className="absolute right-2 text-muted-foreground hover:text-foreground"
        aria-label="Close entity search"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
      >
        <X className="size-3.5" />
      </button>
      {query.trim().length >= 2 ? (
        <div
          className="absolute left-0 top-9 z-30 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
          data-testid="traversal-search-results"
        >
          {searching && !results ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Searching…
            </p>
          ) : results && results.length > 0 ? (
            results.map((row) => (
              <button
                key={`${row.entityTypeSlug}:${row.canonicalId}`}
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() =>
                  onPick({
                    id: `t#${tenantId}#e#${row.canonicalId}`,
                    canonicalId: row.canonicalId,
                    label: row.label,
                    typeLabel: row.entityTypeSlug,
                    isSystem: false,
                    isCenter: true,
                    properties: row.properties,
                  })
                }
              >
                <span className="truncate">{row.label}</span>
                <Badge variant="outline" className="text-[10px] font-normal">
                  {typeNameBySlug.get(row.entityTypeSlug) ?? row.entityTypeSlug}
                </Badge>
              </button>
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No matching entities.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Twin Explorer browse/query surface (THINK-327 U4, R1–R5): the STANDARD
 * DataTableTokenFilter drives everything — entity type, declared facet
 * attributes (typed by filterType), and the declared-relationship path —
 * matching the Memory-tab toolbar idiom (collapsible search + funnel).
 */
export function TwinExplorer({
  onHeaderControllerChange,
}: {
  onHeaderControllerChange?: (
    controller: TwinExplorerHeaderController | null,
  ) => void;
}) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [nameQuery, setNameQuery] = useState("");
  const [activeNameQuery, setActiveNameQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  // Mind Map is the customer-facing default view (customer feedback
  // 2026-07-23); the internal value keeps its historical "traversal" name.
  const [view, setView] = useState<"graph" | "table" | "traversal">(
    "traversal",
  );
  const [panelSelection, setPanelSelection] =
    useState<TwinSheetSelection | null>(null);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const toggleConsole = useCallback(() => setConsoleOpen((open) => !open), []);
  useEffect(() => {
    onHeaderControllerChange?.({ consoleOpen, toggleConsole });
    return () => onHeaderControllerChange?.(null);
  }, [onHeaderControllerChange, consoleOpen, toggleConsole]);

  const [{ data: ontologyData }] = useQuery<{
    ontologyDefinitions?: {
      entityTypes?: ExplorerEntityType[] | null;
      relationshipTypes?: ExplorerRelationshipType[] | null;
    } | null;
  }>({
    query: TwinExplorerOntologyQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const entityTypes = useMemo(
    () =>
      (ontologyData?.ontologyDefinitions?.entityTypes ?? []).filter(
        (type) => (type.lifecycleStatus ?? "").toUpperCase() === "APPROVED",
      ),
    [ontologyData],
  );
  const entityTypeFilter = columnFilters.find(
    (filter) => filter.id === ENTITY_TYPE_COLUMN_ID,
  );
  const selectedTypeSlugs = isDataTableTokenFilterValue(entityTypeFilter?.value)
    ? stringValues(entityTypeFilter.value)
    : [];
  // Default data (no filters yet): customer when declared, else the first
  // approved type — the tab shows the twin immediately, like Memory.
  const defaultEntityType =
    entityTypes.find((type) => type.slug === "customer")?.slug ??
    entityTypes[0]?.slug ??
    "";
  const effectiveEntityTypes = useMemo(() => {
    const known = new Set(entityTypes.map((type) => type.slug));
    const chosen = selectedTypeSlugs.filter((slug) => known.has(slug));
    if (chosen.length > 0) return chosen;
    return defaultEntityType ? [defaultEntityType] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityTypes, selectedTypeSlugs.join(","), defaultEntityType]);
  // Union of the selected types' governed facet declarations — one
  // (facet, attribute) pair appears once even when several selected types
  // declare it.
  const facets: ExplorerFacet[] = useMemo(() => {
    const bySlug = new Map<string, ExplorerFacet>();
    for (const slug of effectiveEntityTypes) {
      const type = entityTypes.find((candidate) => candidate.slug === slug);
      for (const facet of parseExplorerFacets(type?.twinFacets)) {
        const existing = bySlug.get(facet.slug);
        if (!existing) {
          bySlug.set(facet.slug, {
            ...facet,
            attributes: [...facet.attributes],
          });
          continue;
        }
        for (const attribute of facet.attributes) {
          if (
            !existing.attributes.some(
              (candidate) => candidate.attribute === attribute.attribute,
            )
          ) {
            existing.attributes.push(attribute);
          }
        }
      }
    }
    return [...bySlug.values()];
  }, [entityTypes, effectiveEntityTypes]);
  // Path filters offer only declared relationships whose source includes
  // one of the chosen types (R3).
  const pathRelationships = useMemo(
    () =>
      (ontologyData?.ontologyDefinitions?.relationshipTypes ?? []).filter(
        (rel) =>
          (rel.lifecycleStatus ?? "").toUpperCase() === "APPROVED" &&
          effectiveEntityTypes.some((slug) =>
            (rel.sourceTypeSlugs ?? []).includes(slug),
          ),
      ),
    [ontologyData, effectiveEntityTypes],
  );

  // Changing the entity type invalidates facet/path selections — drop any
  // filter the new type doesn't declare.
  useEffect(() => {
    setColumnFilters((current) =>
      current.filter((filter) => {
        if (filter.id === ENTITY_TYPE_COLUMN_ID) return true;
        if (filter.id === PATH_COLUMN_ID) return pathRelationships.length > 0;
        if (!filter.id.startsWith(ATTR_PREFIX)) return true;
        const [facetSlug, attributeName] = filter.id
          .slice(ATTR_PREFIX.length)
          .split(".", 2);
        return facets.some(
          (facet) =>
            facet.slug === facetSlug &&
            facet.attributes.some((a) => a.attribute === attributeName),
        );
      }),
    );
  }, [facets, pathRelationships]);

  // The STANDARD filter columns (KTD-2): entity type first, then one
  // column per declared facet attribute, then the declared-relationship
  // path — all governed, nothing free-form.
  const filterColumns: DataTableTokenFilterColumn[] = useMemo(() => {
    const columns: DataTableTokenFilterColumn[] = [
      {
        id: ENTITY_TYPE_COLUMN_ID,
        label: "Entity type",
        type: "option",
        icon: <Shapes className="h-4 w-4" aria-hidden="true" />,
        options: entityTypes.map((type) => ({
          value: type.slug,
          label: type.name ?? type.slug,
        })),
      },
    ];
    for (const facet of facets) {
      for (const attribute of facet.attributes) {
        columns.push({
          id: `${ATTR_PREFIX}${facet.slug}.${attribute.attribute}`,
          label: `${facet.slug}.${attribute.attribute}`,
          // Declared facet attributes collapse under one "Property"
          // subject — dozens of governed attributes would otherwise flood
          // the top-level list (Eric review, 2026-07-22).
          group: {
            id: "property",
            label: "Property",
            icon: <Tag className="h-4 w-4" aria-hidden="true" />,
          },
          type:
            attribute.filterType === "number"
              ? "number"
              : attribute.filterType === "boolean"
                ? "boolean"
                : "text",
          // The compiler has no negated-contains — offer what it can run.
          operators:
            attribute.filterType === "number" ||
            attribute.filterType === "boolean"
              ? undefined
              : ["contains"],
          icon: <Tag className="h-4 w-4" aria-hidden="true" />,
        });
      }
    }
    if (effectiveEntityTypes.length > 0 && pathRelationships.length > 0) {
      columns.push({
        id: PATH_COLUMN_ID,
        label: "Related to",
        type: "option",
        singleSelect: true,
        icon: <Link2 className="h-4 w-4" aria-hidden="true" />,
        options: pathRelationships.map((rel) => ({
          value: rel.slug,
          label: rel.name ?? rel.slug,
        })),
      });
    }
    return columns;
  }, [entityTypes, facets, effectiveEntityTypes, pathRelationships]);

  // Headless table purely to drive the standard filter UI (the Memory
  // graphFilterTable pattern) — the cohort query is server-filtered.
  const filterTableColumns = useMemo(
    () =>
      filterColumns.map(
        (column): ColumnDef<Record<string, unknown>> => ({
          id: column.id,
          filterFn:
            dataTableTokenFilterFns[
              column.type as keyof typeof dataTableTokenFilterFns
            ],
        }),
      ),
    [filterColumns],
  );
  const filterTable = useReactTable({
    data: [] as Array<Record<string, unknown>>,
    columns: filterTableColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const model = useMemo(
    () => buildExplorerFilterModel(columnFilters, facets, pathRelationships),
    [columnFilters, facets, pathRelationships],
  );

  const filter = useMemo(() => {
    const compiled: Record<string, unknown> = { predicates: model.predicates };
    if (activeNameQuery) compiled.nameContains = activeNameQuery;
    if (model.path) compiled.path = model.path;
    return compiled;
  }, [model, activeNameQuery]);

  // One cohort query per selected type, unioned client-side (the compiler
  // scopes a cohort to a single label).
  const client = useClient();

  // ── Traversal (twin-traversal plan U4) ──────────────────────────────
  // State lives in a mutable model (TwinTraversal.ts); `traversalRev`
  // bumps re-render the derived graph, `traversalEpoch` remounts the
  // graph (fresh camera) when the canvas is REPLACED rather than grown.
  const traversalRef = useRef<TraversalState>(createTraversal());
  const [traversalRev, setTraversalRev] = useState(0);
  const [traversalEpoch, setTraversalEpoch] = useState(0);
  const [traversalError, setTraversalError] = useState<string | null>(null);
  const bumpTraversal = useCallback(() => setTraversalRev((r) => r + 1), []);
  const traversalActive = traversalRef.current.rootIds.length > 0;

  // Fetch the next member batch for a summary group (R6/R11).
  const fetchMembers = useCallback(
    (key: string) => {
      const state = traversalRef.current;
      const group = state.groups.get(key);
      if (!tenantId || !group || state.pending.has(key)) return;
      const focal = state.nodesById.get(group.focalId);
      if (!focal?.canonicalId) return;
      state.pending.add(key);
      bumpTraversal();
      void client
        .query(TwinNeighborMembersQuery, {
          tenantId,
          canonicalId: focal.canonicalId,
          relationship: group.relationship,
          targetType: group.targetType,
          direction: group.direction,
          offset: group.loadedOffset,
          limit: TRAVERSAL_BATCH_SIZE,
        })
        .toPromise()
        .then((result) => {
          state.pending.delete(key);
          const batch = parseTwinMemberBatch(
            (result.data as { twinNeighborMembers?: unknown } | undefined)
              ?.twinNeighborMembers,
          );
          if (batch) {
            addMembers(state, key, batch.nodes, batch.links);
            setGroupExpanded(state, key, true);
            setTraversalError(null);
          } else {
            setTraversalError(
              result.error?.message ?? "Could not load the group.",
            );
          }
          bumpTraversal();
        });
    },
    [client, tenantId, bumpTraversal],
  );

  // Fetch an entity's summary ring (R5/R7). Pending guard blocks
  // double-fires; a query error surfaces as a toast-style alert and
  // leaves traversal state unchanged. Singleton rows (count 1) render the
  // actual member instead of a "(1)" hub, so their lone member is fetched
  // eagerly here.
  const fetchSummary = useCallback(
    (node: TwinGraphNode) => {
      const state = traversalRef.current;
      if (
        !tenantId ||
        !node.canonicalId ||
        state.summaries.has(node.id) ||
        state.pending.has(node.id)
      ) {
        return;
      }
      state.pending.add(node.id);
      bumpTraversal();
      void client
        .query(TwinNeighborSummaryQuery, {
          tenantId,
          canonicalId: node.canonicalId,
        })
        .toPromise()
        .then((result) => {
          state.pending.delete(node.id);
          const rows = parseTwinSummaryRows(
            (result.data as { twinNeighborSummary?: unknown } | undefined)
              ?.twinNeighborSummary,
          );
          if (rows) {
            setSummary(state, node.id, rows);
            setTraversalError(null);
            for (const row of rows) {
              if (row.count === 1) fetchMembers(groupKey(node.id, row));
            }
          } else {
            setTraversalError(
              result.error?.message ?? "Could not load relations.",
            );
          }
          bumpTraversal();
        });
    },
    [client, tenantId, bumpTraversal, fetchMembers],
  );

  /**
   * Traversal entry (KTD-7): a search pick or overview-node click REPLACES
   * the canvas; filter/table checkboxes accumulate roots (R9).
   */
  const rootTraversal = useCallback(
    (node: TwinGraphNode, options?: { replace?: boolean }) => {
      if (options?.replace) {
        traversalRef.current = createTraversal();
        setTraversalEpoch((epoch) => epoch + 1);
      }
      addRoot(traversalRef.current, { ...node, isCenter: true });
      bumpTraversal();
      fetchSummary(node);
    },
    [bumpTraversal, fetchSummary],
  );

  const clearTraversal = useCallback(() => {
    traversalRef.current = createTraversal();
    setTraversalError(null);
    setPanelSelection(null);
    setTraversalEpoch((epoch) => epoch + 1);
    bumpTraversal();
  }, [bumpTraversal]);

  const toggleTraversalRoot = useCallback(
    (node: TwinGraphNode) => {
      const state = traversalRef.current;
      if (state.rootIds.includes(node.id)) {
        removeRoot(state, node.id);
        bumpTraversal();
      } else {
        rootTraversal(node);
      }
    },
    [bumpTraversal, rootTraversal],
  );

  // Summary group toggle (R6): collapse if open; instant re-expand from
  // cache; first expand fetches the first member batch. Shared by the
  // force renderer (Graph view) and the mind map (Traversal view).
  const toggleSummaryGroup = useCallback(
    (key: string) => {
      const state = traversalRef.current;
      const group = state.groups.get(key);
      if (!group) return;
      if (group.expanded) {
        setGroupExpanded(state, key, false);
        bumpTraversal();
      } else if ((state.members.get(key)?.length ?? 0) > 0) {
        setGroupExpanded(state, key, true);
        bumpTraversal();
      } else {
        fetchMembers(key);
      }
    },
    [bumpTraversal, fetchMembers],
  );

  // Click routing (customer feedback 2026-07-23): a single click on an
  // entity opens the docked detail panel; summary hubs and "+N more…"
  // keep their single-click expand since they carry no properties.
  const handleTraversalNodeClick = useCallback(
    (node: TwinGraphNode) => {
      if (node.kind === "none") return;
      if (node.kind === "more") {
        const key = groupKeyFromSyntheticId(node.id);
        if (key) fetchMembers(key);
        return;
      }
      if (node.kind === "summary") {
        const key = groupKeyFromSyntheticId(node.id);
        if (key) toggleSummaryGroup(key);
        return;
      }
      if (!node.isSystem) setPanelSelection({ kind: "node", node });
    },
    [toggleSummaryGroup, fetchMembers],
  );

  // Dbl-click EXPANDS the entity — attaches its relationship ring.
  const handleEntityDoubleClick = useCallback(
    (node: TwinGraphNode) => {
      if (node.kind || node.isSystem) return;
      fetchSummary(node);
    },
    [fetchSummary],
  );
  const [cohort, setCohort] = useState<{
    key: string;
    fetching: boolean;
    error: string | null;
    responses: Array<{ entityType: string; payload: unknown }> | null;
  }>({ key: "", fetching: false, error: null, responses: null });
  const cohortKey = JSON.stringify([tenantId, effectiveEntityTypes, filter]);
  const cohortGenRef = useRef(0);
  useEffect(() => {
    if (
      !tenantId ||
      effectiveEntityTypes.length === 0 ||
      view !== "table" ||
      model.errors.length > 0
    ) {
      return;
    }
    const generation = ++cohortGenRef.current;
    setCohort({ key: cohortKey, fetching: true, error: null, responses: null });
    void Promise.all(
      effectiveEntityTypes.map((entityType) =>
        client
          .query(TwinCohortQuery, {
            tenantId,
            entityType,
            filter: JSON.stringify(filter),
            limit: COHORT_LIMIT,
          })
          .toPromise()
          .then((result) => ({
            entityType,
            payload: (result.data as { twinCohort?: unknown } | undefined)
              ?.twinCohort,
            error: result.error?.message ?? null,
          })),
      ),
    ).then((results) => {
      if (generation !== cohortGenRef.current) return;
      setCohort({
        key: cohortKey,
        fetching: false,
        error: results.find((r) => r.error)?.error ?? null,
        responses: results.map(({ entityType, payload }) => ({
          entityType,
          payload,
        })),
      });
    });
    // `client` is render-stable from the urql Provider — deliberately out
    // of the deps so a test double returning a fresh object per render
    // can't loop the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohortKey, view, model.errors.length > 0]);

  const fetching =
    cohort.fetching || (view === "table" && cohort.key !== cohortKey);
  const error = cohort.error;
  const typeNameBySlug = useMemo(
    () =>
      new Map(entityTypes.map((type) => [type.slug, type.name ?? type.slug])),
    [entityTypes],
  );
  const relNameBySlug = useMemo(
    () =>
      new Map(
        (ontologyData?.ontologyDefinitions?.relationshipTypes ?? []).map(
          (rel) => [rel.slug, rel.name ?? rel.slug],
        ),
      ),
    [ontologyData],
  );

  // Shared display-name accessors for both traversal renderers.
  const traversalLabels = useMemo(
    () => ({
      relationshipLabel: (slug: string) => relNameBySlug.get(slug) ?? slug,
      typeLabel: (slug: string) => typeNameBySlug.get(slug) ?? slug,
    }),
    [relNameBySlug, typeNameBySlug],
  );

  // Derived traversal canvas — rebuilt per rev bump; node/link object
  // identity comes from the model's caches, so positions and camera hold.
  const traversalData: TwinGraphData = useMemo(
    () => buildTraversalGraphData(traversalRef.current, traversalLabels),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [traversalRev, traversalLabels],
  );
  const rows = useMemo(() => {
    if (!cohort.responses || cohort.key !== cohortKey) return null;
    const merged: Array<CohortRow & { entityTypeSlug: string }> = [];
    for (const response of cohort.responses) {
      const part = parseTwinCohortRows(response.payload);
      for (const row of part ?? []) {
        merged.push({ ...row, entityTypeSlug: response.entityType });
      }
    }
    return merged;
  }, [cohort, cohortKey]);
  const failure = useMemo(() => {
    if (!cohort.responses || cohort.key !== cohortKey) return null;
    for (const response of cohort.responses) {
      const parsed = parseTwinCohortFailure(response.payload);
      if (parsed) return parsed;
    }
    return null;
  }, [cohort, cohortKey]);

  // Columns: name + each referenced (facet, attribute) value + one state
  // chip per referenced facet (R5).
  const referenced = useMemo(() => {
    const pairs = new Map<string, { facet: string; attribute: string }>();
    for (const predicate of model.predicates) {
      pairs.set(`${predicate.facet}.${predicate.attribute}`, {
        facet: predicate.facet,
        attribute: predicate.attribute,
      });
    }
    return [...pairs.values()];
  }, [model.predicates]);
  const referencedFacets = useMemo(
    () => [...new Set(referenced.map((pair) => pair.facet))],
    [referenced],
  );

  const columns: ColumnDef<CohortRow & { entityTypeSlug: string }>[] = useMemo(
    () => [
      {
        // Traversal roots (R9): checking rows accumulates roots on the
        // graph canvas; unchecking prunes that root's subtree.
        id: "select",
        header: "",
        cell: ({ row }) => {
          const canonicalId = row.original.canonicalId;
          if (!canonicalId) return null;
          const nodeId = `t#${tenantId}#e#${canonicalId}`;
          return (
            <span
              className="flex h-10 items-center px-2"
              onClick={(event) => event.stopPropagation()}
            >
              <Checkbox
                aria-label={`Traverse from ${row.original.label}`}
                checked={traversalRef.current.rootIds.includes(nodeId)}
                onCheckedChange={() =>
                  toggleTraversalRoot({
                    id: nodeId,
                    canonicalId,
                    label: row.original.label,
                    typeLabel: row.original.entityTypeSlug,
                    isSystem: false,
                    isCenter: true,
                    properties: row.original.properties,
                  })
                }
              />
            </span>
          );
        },
      },
      {
        id: "label",
        header: "Name",
        cell: ({ row }) => (
          <span className="flex h-10 items-center px-2 font-medium">
            <span className="truncate">{row.original.label}</span>
          </span>
        ),
      },
      ...(effectiveEntityTypes.length > 1
        ? [
            {
              id: "entityType",
              header: "Type",
              cell: ({ row }) => (
                <span className="flex h-10 items-center px-2">
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {typeNameBySlug.get(row.original.entityTypeSlug) ??
                      row.original.entityTypeSlug}
                  </Badge>
                </span>
              ),
            } satisfies ColumnDef<CohortRow & { entityTypeSlug: string }>,
          ]
        : []),
      ...referenced.map(
        (pair): ColumnDef<CohortRow & { entityTypeSlug: string }> => ({
          id: `${pair.facet}.${pair.attribute}`,
          header: `${pair.facet}.${pair.attribute}`,
          cell: ({ row }) => {
            const value =
              row.original.properties[`f_${pair.facet}__${pair.attribute}`];
            return (
              <span className="flex h-10 items-center px-2 text-muted-foreground">
                {value == null ? "—" : String(value)}
              </span>
            );
          },
        }),
      ),
      ...referencedFacets.map(
        (facetSlug): ColumnDef<CohortRow & { entityTypeSlug: string }> => ({
          id: `${facetSlug}-state`,
          header: `${facetSlug} state`,
          cell: ({ row }) => {
            const state = row.original.properties[`f_${facetSlug}__state`];
            return (
              <span className="flex h-10 items-center px-2">
                <Badge variant="outline" className="text-[10px] font-normal">
                  {typeof state === "string" && state ? state : "synced"}
                </Badge>
              </span>
            );
          },
        }),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      referenced,
      referencedFacets,
      effectiveEntityTypes,
      typeNameBySlug,
      tenantId,
      toggleTraversalRoot,
      // Re-render checkbox states after every traversal mutation.
      traversalRev,
    ],
  );

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
      <SettingsPageTitle
        title="Company Brain"
        description="Browse the company brain — live entities projected from your source systems."
        badge={
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(next) => {
              if (next === "graph" || next === "table" || next === "traversal")
                setView(next);
            }}
            variant="outline"
            className="ml-4 h-8 overflow-hidden rounded-full border bg-background shadow-sm"
          >
            <ToggleGroupItem
              value="traversal"
              className="h-full rounded-none border-0 px-3 text-sm font-medium"
              aria-label="Mind map view"
            >
              Mind Map
            </ToggleGroupItem>
            <ToggleGroupItem
              value="graph"
              className="h-full rounded-none border-0 border-l border-border px-3 text-sm font-medium"
              aria-label="Graph view"
            >
              Graph
            </ToggleGroupItem>
            <ToggleGroupItem
              value="table"
              className="h-full rounded-none border-0 border-l border-border px-3 text-sm font-medium"
              aria-label="Table view"
            >
              Table
            </ToggleGroupItem>
          </ToggleGroup>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* R1: the search/filter toolbar hides while the console is open. */}
        {!consoleOpen ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* Collapsible search — the Memory tab's toolbar idiom. In
                graph view it is the server-backed entity picker (traversal
                entry); in table view it filters the cohort. */}
            {!(searchExpanded || nameQuery.length > 0) ? (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="h-8 w-8 rounded-md"
                aria-label="Search by name"
                data-testid="explorer-search-toggle"
                disabled={effectiveEntityTypes.length === 0}
                onClick={() => setSearchExpanded(true)}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : view !== "table" ? (
              <TwinEntitySearchPicker
                tenantId={tenantId}
                typeSlugs={
                  selectedTypeSlugs.length > 0
                    ? effectiveEntityTypes
                    : entityTypes.map((type) => type.slug)
                }
                typeNameBySlug={typeNameBySlug}
                onPick={(node) => {
                  setSearchExpanded(false);
                  rootTraversal(node, { replace: true });
                }}
                onClose={() => setSearchExpanded(false)}
              />
            ) : (
              <div className="relative flex h-8 w-[min(20rem,calc(100vw-2rem))] items-center">
                <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  type="search"
                  className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="Search by name..."
                  aria-label="Search by name"
                  data-testid="explorer-name-search"
                  value={nameQuery}
                  onBlur={() => {
                    if (!nameQuery) setSearchExpanded(false);
                  }}
                  onChange={(event) => setNameQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      setActiveNameQuery(nameQuery.trim());
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setNameQuery("");
                      setActiveNameQuery("");
                      setSearchExpanded(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="absolute right-2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear name search"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setNameQuery("");
                    setActiveNameQuery("");
                    setSearchExpanded(false);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            <DataTableTokenFilter
              table={filterTable}
              columns={filterColumns}
              addLabel="Filter"
              showAddLabel={false}
              clearLabel="Clear filters"
              flattenToolbar
              className="max-w-full [&_[data-token-filter-token]]:shrink-0"
              popoverClassName="w-[min(18rem,calc(100vw-2rem))]"
            />
          </div>
        ) : null}

        {consoleOpen ? <CypherConsole /> : null}

        {effectiveEntityTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No approved entity types yet — declare one in the Ontology tab.
          </p>
        ) : null}

        {model.errors.length > 0 ? (
          <p
            className="text-sm text-amber-600"
            data-testid="explorer-build-errors"
          >
            {model.errors.join(" · ")}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-red-500" role="alert">
            Query failed: {error}
          </p>
        ) : null}
        {failure ? (
          failure.reason === "invalid_request" ? (
            <p
              className="text-sm text-amber-600"
              data-testid="explorer-compile-error"
            >
              The twin rejected this filter
              {failure.detail ? `: ${failure.detail}` : "."}
            </p>
          ) : (
            <p
              className="text-sm text-muted-foreground"
              data-testid="explorer-unavailable"
            >
              The twin isn&apos;t available right now
              {failure.detail ? ` (${failure.detail})` : ""} — try again
              shortly.
            </p>
          )
        ) : null}

        {traversalError ? (
          <p className="text-sm text-red-500" role="alert">
            {traversalError}
          </p>
        ) : null}

        {view === "graph" && effectiveEntityTypes.length > 0 ? (
          <div className="flex min-h-[28rem] flex-1 gap-3">
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
              {traversalActive ? (
                /* Traversal mode: single click opens the detail panel,
                   dbl-click expands the entity's relationship ring. */
                <TwinGraph
                  key={`traversal-${traversalEpoch}`}
                  tenantId={tenantId}
                  data={traversalData}
                  revision={traversalRev}
                  onNodeClick={handleTraversalNodeClick}
                  onNodeDoubleClick={handleEntityDoubleClick}
                  onLinkClick={(link: TwinGraphLink) => {
                    // Synthetic summary/more edges carry no properties —
                    // only real relationship edges open the panel.
                    if (!link.id.startsWith("link:")) {
                      setPanelSelection({ kind: "edge", link });
                    }
                  }}
                />
              ) : (
                /* Overview (R10): single click opens the detail panel;
                   dbl-click roots a traversal on that entity (KTD-7). */
                <TwinGraph
                  tenantId={tenantId}
                  loadingFallback={
                    <div className="flex h-full min-h-48 items-center justify-center">
                      <LoadingShimmer />
                    </div>
                  }
                  subgraphEntityTypes={effectiveEntityTypes}
                  subgraphLimit={25}
                  depth={1}
                  onNodeClick={(node: TwinGraphNode) => {
                    if (!node.isSystem) {
                      setPanelSelection({ kind: "node", node });
                    }
                  }}
                  onNodeDoubleClick={(node: TwinGraphNode) => {
                    if (!node.isSystem && node.canonicalId) {
                      rootTraversal(node, { replace: true });
                    }
                  }}
                  onLinkClick={(link: TwinGraphLink) =>
                    setPanelSelection({ kind: "edge", link })
                  }
                />
              )}
              {traversalActive ? (
                <div className="pointer-events-none absolute inset-0 z-20">
                  <button
                    type="button"
                    className="pointer-events-auto absolute top-3 left-3 z-30 flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                    data-testid="traversal-clear"
                    onClick={clearTraversal}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    Back to overview
                  </button>
                </div>
              ) : null}
            </div>
            {panelSelection ? (
              <TwinDetailPanel
                selection={panelSelection}
                labels={traversalLabels}
                onClose={() => setPanelSelection(null)}
              />
            ) : (
              <TwinStatsPanel
                data={traversalData}
                typeLabel={traversalLabels.typeLabel}
              />
            )}
          </div>
        ) : null}

        {view === "traversal" && effectiveEntityTypes.length > 0 ? (
          <div className="flex min-h-[28rem] flex-1 gap-3">
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
              {traversalActive ? (
                <>
                  <TwinMindMap
                    key={`mindmap-${traversalEpoch}`}
                    state={traversalRef.current}
                    revision={traversalRev}
                    labels={traversalLabels}
                    onEntityClick={(entity) => {
                      // Single click → docked detail panel; dbl-click
                      // expands (customer feedback 2026-07-23).
                      if (!entity.isSystem) {
                        setPanelSelection({ kind: "node", node: entity });
                      }
                    }}
                    onEntityDoubleClick={handleEntityDoubleClick}
                    onSummaryClick={toggleSummaryGroup}
                    onMoreClick={fetchMembers}
                    onEdgeClick={(link) =>
                      setPanelSelection({ kind: "edge", link })
                    }
                  />
                  <button
                    type="button"
                    className="absolute top-3 left-3 z-30 flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                    data-testid="mindmap-clear"
                    onClick={clearTraversal}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    Clear
                  </button>
                </>
              ) : (
                <div
                  className="flex h-full min-h-48 items-center justify-center py-16"
                  data-testid="mindmap-empty"
                >
                  {/* Ghost root pill — the guidance lives in the side
                      panel (Eric 2026-07-23). */}
                  <div className="rounded-full border border-dashed border-muted-foreground/40 px-6 py-2.5 text-sm text-muted-foreground/60 select-none">
                    Pick a starting entity
                  </div>
                </div>
              )}
            </div>
            {panelSelection ? (
              <TwinDetailPanel
                selection={panelSelection}
                labels={traversalLabels}
                onClose={() => setPanelSelection(null)}
              />
            ) : (
              <TwinStatsPanel
                data={traversalData}
                typeLabel={traversalLabels.typeLabel}
              />
            )}
          </div>
        ) : null}

        {view === "table" &&
        effectiveEntityTypes.length > 0 &&
        fetching &&
        !rows ? (
          <div
            className="flex min-h-40 flex-1 items-center justify-center"
            data-testid="explorer-loading"
          >
            <LoadingShimmer />
          </div>
        ) : null}

        {view === "table" && rows ? (
          rows.length > 0 ? (
            <div className="min-h-0 flex-1">
              {rows.length >= COHORT_LIMIT ? (
                <p
                  className="mb-2 text-xs text-muted-foreground"
                  data-testid="explorer-limit-note"
                >
                  Showing the first {COHORT_LIMIT} matches — narrow the filter
                  to see the rest.
                </p>
              ) : null}
              <DataTable
                columns={columns}
                data={rows}
                onRowClick={(row) => {
                  if (!row.canonicalId) return;
                  void navigate({
                    to: "/settings/memory/explorer/$entityType/$canonicalId",
                    params: {
                      entityType: row.entityTypeSlug,
                      canonicalId: row.canonicalId,
                    },
                  });
                }}
              />
            </div>
          ) : (
            <p
              className="text-sm text-muted-foreground"
              data-testid="explorer-empty"
            >
              No matching entities.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}
