import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClient, useQuery } from "urql";
import { LoadingShimmer } from "@/components/LoadingShimmer";
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
  type TwinGraphLink,
  type TwinGraphNode,
} from "@thinkwork/graph";
import { TwinNodeSheet, type TwinSheetSelection } from "./TwinNodeSheet";
import {
  TwinCohortQuery,
  TwinExplorerOntologyQuery,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { CypherConsole } from "./CypherConsole";
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
  const [view, setView] = useState<"graph" | "table">("graph");
  const [sheetSelection, setSheetSelection] =
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
    [referenced, referencedFacets, effectiveEntityTypes, typeNameBySlug],
  );

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <div className="shrink-0 space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Explorer
          </h1>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(next) => {
              if (next === "graph" || next === "table") setView(next);
            }}
            className="rounded-full border border-border p-0.5"
          >
            <ToggleGroupItem
              value="graph"
              className="h-7 rounded-full px-3 text-xs"
              aria-label="Graph view"
            >
              Graph
            </ToggleGroupItem>
            <ToggleGroupItem
              value="table"
              className="h-7 rounded-full px-3 text-xs"
              aria-label="Table view"
            >
              Table
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <p className="text-sm text-muted-foreground">
          Browse the digital twin — live entities projected from your source
          systems.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* Collapsible search — the Memory tab's toolbar idiom. */}
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
                if (event.key === "Enter") setActiveNameQuery(nameQuery.trim());
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
            {failure.detail ? ` (${failure.detail})` : ""} — try again shortly.
          </p>
        )
      ) : null}

      {view === "graph" && effectiveEntityTypes.length > 0 ? (
        <div className="relative min-h-[28rem] flex-1 overflow-hidden rounded-lg border border-border">
          <TwinGraph
            tenantId={tenantId}
            loadingFallback={
              <div className="flex h-full min-h-48 items-center justify-center">
                <LoadingShimmer />
              </div>
            }
            subgraphEntityTypes={effectiveEntityTypes}
            subgraphLimit={25}
            depth={2}
            onNodeClick={(node: TwinGraphNode) =>
              setSheetSelection({ kind: "node", node })
            }
            onLinkClick={(link: TwinGraphLink) =>
              setSheetSelection({ kind: "edge", link })
            }
          />
          <TwinNodeSheet
            selection={sheetSelection}
            onOpenChange={(open) => {
              if (!open) setSheetSelection(null);
            }}
            onOpenEntity={(target) => {
              setSheetSelection(null);
              void navigate({
                to: "/settings/memory/explorer/$entityType/$canonicalId",
                params: target,
              });
            }}
          />
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
                Showing the first {COHORT_LIMIT} matches — narrow the filter to
                see the rest.
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
  );
}
