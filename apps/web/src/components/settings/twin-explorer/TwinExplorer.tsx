import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { useNavigate } from "@tanstack/react-router";
import { Search, Terminal, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  DataTable,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import {
  TwinCohortQuery,
  TwinExplorerOntologyQuery,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import { CypherConsole } from "./CypherConsole";
import {
  PredicateBuilder,
  buildTypedPredicate,
  parseExplorerFacets,
  type ExplorerFacet,
  type ExplorerPredicateRow,
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

/**
 * Twin Explorer browse/query surface (THINK-327 U4, R1–R5): governed type
 * picker, AND-only predicate builder, declared-relationship path filter,
 * name search, and a cohort results table linking into the entity detail.
 */
export function TwinExplorer() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [entityType, setEntityType] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [activeNameQuery, setActiveNameQuery] = useState("");
  const [predicateRows, setPredicateRows] = useState<ExplorerPredicateRow[]>(
    [],
  );
  const [pathRelationship, setPathRelationship] = useState("");
  const [pathTargetType, setPathTargetType] = useState("");
  const [pathPredicateRows, setPathPredicateRows] = useState<
    ExplorerPredicateRow[]
  >([]);
  const [consoleOpen, setConsoleOpen] = useState(false);

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
        (type) => type.lifecycleStatus === "approved",
      ),
    [ontologyData],
  );
  const selectedType = entityTypes.find((type) => type.slug === entityType);
  const facets: ExplorerFacet[] = useMemo(
    () => parseExplorerFacets(selectedType?.twinFacets),
    [selectedType],
  );
  // Path filters offer only declared relationships whose source includes
  // the chosen type (R3).
  const pathRelationships = useMemo(
    () =>
      (ontologyData?.ontologyDefinitions?.relationshipTypes ?? []).filter(
        (rel) =>
          rel.lifecycleStatus === "approved" &&
          !!entityType &&
          (rel.sourceTypeSlugs ?? []).includes(entityType),
      ),
    [ontologyData, entityType],
  );
  const selectedRelationship = pathRelationships.find(
    (rel) => rel.slug === pathRelationship,
  );
  const pathTargetTypes = selectedRelationship?.targetTypeSlugs ?? [];
  const pathTargetFacets: ExplorerFacet[] = useMemo(
    () =>
      parseExplorerFacets(
        entityTypes.find((type) => type.slug === pathTargetType)?.twinFacets,
      ),
    [entityTypes, pathTargetType],
  );

  // Build the typed filter; rows that don't validate surface inline and
  // keep the query on its last valid shape (pause on error).
  const build = useMemo(() => {
    const errors: string[] = [];
    const predicates: TypedPredicate[] = [];
    for (const row of predicateRows) {
      const built = buildTypedPredicate(row, facets);
      if (built.ok) predicates.push(built.predicate);
      else errors.push(built.error);
    }
    const filter: Record<string, unknown> = { predicates };
    if (activeNameQuery) filter.nameContains = activeNameQuery;
    if (pathRelationship && pathTargetType) {
      const pathPredicates: TypedPredicate[] = [];
      for (const row of pathPredicateRows) {
        const built = buildTypedPredicate(row, pathTargetFacets);
        if (built.ok) pathPredicates.push(built.predicate);
        else errors.push(built.error);
      }
      filter.path = {
        relationship: pathRelationship,
        targetType: pathTargetType,
        predicates: pathPredicates,
      };
    }
    return { filter, errors };
  }, [
    predicateRows,
    facets,
    activeNameQuery,
    pathRelationship,
    pathTargetType,
    pathPredicateRows,
    pathTargetFacets,
  ]);

  const hasQuery =
    !!entityType &&
    (build.filter.predicates as TypedPredicate[]).length +
      (activeNameQuery ? 1 : 0) >=
      0; // browsing with zero predicates is a valid cohort (list the type)

  const [{ data: cohortData, fetching, error }] = useQuery<{
    twinCohort?: unknown;
  }>({
    query: TwinCohortQuery,
    variables: {
      tenantId,
      entityType,
      filter: JSON.stringify(build.filter),
      limit: COHORT_LIMIT,
    },
    pause: !tenantId || !hasQuery || build.errors.length > 0,
  });

  const rows = useMemo(
    () => parseTwinCohortRows(cohortData?.twinCohort),
    [cohortData],
  );
  const failure = useMemo(
    () => parseTwinCohortFailure(cohortData?.twinCohort),
    [cohortData],
  );

  // Columns: name + each referenced (facet, attribute) value + one state
  // chip per referenced facet (R5).
  const referenced = useMemo(() => {
    const pairs = new Map<string, { facet: string; attribute: string }>();
    for (const row of predicateRows) {
      if (row.facet && row.attribute) {
        pairs.set(`${row.facet}.${row.attribute}`, {
          facet: row.facet,
          attribute: row.attribute,
        });
      }
    }
    return [...pairs.values()];
  }, [predicateRows]);
  const referencedFacets = useMemo(
    () => [...new Set(referenced.map((pair) => pair.facet))],
    [referenced],
  );

  const columns: ColumnDef<CohortRow>[] = useMemo(
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
      ...referenced.map(
        (pair): ColumnDef<CohortRow> => ({
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
        (facetSlug): ColumnDef<CohortRow> => ({
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
    [referenced, referencedFacets],
  );

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading tenant...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Select
          value={entityType || undefined}
          onValueChange={(slug) => {
            setEntityType(slug);
            setPredicateRows([]);
            setPathRelationship("");
            setPathTargetType("");
            setPathPredicateRows([]);
          }}
        >
          <SelectTrigger
            className="h-9 w-44"
            aria-label="Entity type"
            data-testid="explorer-entity-type"
          >
            <SelectValue placeholder="Entity type" />
          </SelectTrigger>
          <SelectContent>
            {entityTypes.map((type) => (
              <SelectItem key={type.slug} value={type.slug}>
                {type.name ?? type.slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 w-64 pl-8"
            placeholder="Search by name…"
            aria-label="Search by name"
            data-testid="explorer-name-search"
            value={nameQuery}
            onChange={(event) => setNameQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setActiveNameQuery(nameQuery.trim());
            }}
            disabled={!entityType}
          />
          {activeNameQuery ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear name search"
              onClick={() => {
                setNameQuery("");
                setActiveNameQuery("");
              }}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className={
            consoleOpen
              ? "ml-auto flex h-9 items-center gap-1.5 rounded-md border border-border bg-primary/10 px-3 text-xs text-primary"
              : "ml-auto flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          }
          aria-pressed={consoleOpen}
          data-testid="explorer-console-toggle"
          onClick={() => setConsoleOpen((open) => !open)}
        >
          <Terminal className="size-3.5" /> Console
        </button>
      </div>

      {consoleOpen ? <CypherConsole /> : null}

      {entityType ? (
        <PredicateBuilder
          facets={facets}
          rows={predicateRows}
          onChange={setPredicateRows}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick an entity type to browse the twin.
        </p>
      )}

      {entityType && pathRelationships.length > 0 ? (
        <div className="space-y-2" data-testid="explorer-path-filter">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Related to
            </span>
            <Select
              value={pathRelationship || undefined}
              onValueChange={(slug) => {
                setPathRelationship(slug);
                const targets =
                  pathRelationships.find((rel) => rel.slug === slug)
                    ?.targetTypeSlugs ?? [];
                setPathTargetType(targets.length === 1 ? targets[0]! : "");
                setPathPredicateRows([]);
              }}
            >
              <SelectTrigger
                className="h-8 w-48 text-xs"
                aria-label="Relationship"
                data-testid="explorer-path-relationship"
              >
                <SelectValue placeholder="Relationship (optional)" />
              </SelectTrigger>
              <SelectContent>
                {pathRelationships.map((rel) => (
                  <SelectItem key={rel.slug} value={rel.slug}>
                    {rel.name ?? rel.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pathRelationship && pathTargetTypes.length > 1 ? (
              <Select
                value={pathTargetType || undefined}
                onValueChange={setPathTargetType}
              >
                <SelectTrigger
                  className="h-8 w-40 text-xs"
                  aria-label="Target type"
                >
                  <SelectValue placeholder="Target type" />
                </SelectTrigger>
                <SelectContent>
                  {pathTargetTypes.map((slug) => (
                    <SelectItem key={slug} value={slug}>
                      {slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {pathRelationship ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                aria-label="Clear path filter"
                onClick={() => {
                  setPathRelationship("");
                  setPathTargetType("");
                  setPathPredicateRows([]);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          {pathRelationship && pathTargetType ? (
            <div className="pl-6">
              <PredicateBuilder
                facets={pathTargetFacets}
                rows={pathPredicateRows}
                onChange={setPathPredicateRows}
                idPrefix="path-predicate"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {build.errors.length > 0 ? (
        <p
          className="text-sm text-amber-600"
          data-testid="explorer-build-errors"
        >
          {build.errors.join(" · ")}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-500" role="alert">
          Query failed: {error.message}
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

      {entityType && fetching && !cohortData ? (
        <div className="space-y-2" data-testid="explorer-loading">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}

      {rows ? (
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
                    entityType,
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
