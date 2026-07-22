import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { useQuery } from "urql";
import {
  Activity,
  BadgeCheck,
  Compass,
  FileText,
  Search,
  X,
} from "lucide-react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Button,
  DataTableTokenFilter,
  dataTableTokenFilterFns,
  Input,
  Sheet,
  SheetContent,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";
import {
  OntologyGraph,
  type OntologyGraphHandle,
  type OntologyGraphNode,
} from "@thinkwork/graph";
import { OntologyChangeSetStatus } from "@/gql/graphql";
import { SettingsOntologySchemaGraphQuery } from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import {
  dismissPackCallout,
  usePackCalloutDismissed,
} from "@/lib/ontology-pack-callout-pref";
import {
  OntologyReviewRail,
  ontologyCandidateLabel,
  type OntologyRailCandidate,
} from "./OntologyReviewRail";
import {
  OntologyCandidateSheet,
  type OntologyFocus,
} from "./OntologyCandidateSheet";
import {
  OntologyTripleForm,
  ontologySlugify,
  type OntologyEditableItem,
} from "./OntologyTripleForm";

type SheetEntry =
  | { kind: "queue" }
  | { kind: "focus"; focus: OntologyFocus }
  | { kind: "form"; editItem: OntologyEditableItem | null };

// Collapsible search matching the Memory/Wiki graph toolbars: a search-icon
// button that expands into an input. Drives the live `searchQuery` the
// canvas dims against (R3 — non-matching nodes dim in place, never removed).
function OntologyToolbarSearch({
  searchQuery,
  onSearchQueryChange,
}: {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || searchQuery.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const clearSearch = () => {
    onSearchQueryChange("");
    setExpanded(false);
  };

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-8 w-8 rounded-md"
        aria-label="Search the ontology map"
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(20rem,calc(100vw-2rem))] items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search the ontology map"
        placeholder="Search types..."
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={searchQuery}
        onBlur={() => {
          if (!searchQuery) setExpanded(false);
        }}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            clearSearch();
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Clear search"
        onMouseDown={(e) => e.preventDefault()}
        onClick={clearSearch}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** "suggestion_engine" → "Suggestion engine" (candidate provenance values). */
function ontologyOriginLabel(origin: string): string {
  const words = origin.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : origin;
}

/**
 * Header-action surface lifted to the page-header owner (SettingsMemoryHome),
 * following the SettingsMemory refresh/raw-units controller pattern: the map
 * publishes its pending count and the two gestures; the header renders the
 * "+ Add triple" button and the badged review-queue inbox icon.
 */
export interface OntologyMapHeaderController {
  pendingCount: number;
  openAddTriple: () => void;
  openQueue: () => void;
}

/**
 * The platform seeds every tenant with 4 baseline types (customer, person,
 * project, task). A tenant still at or under that count with nothing pending
 * has never grown its schema — the day-one pack callout's trigger (R12).
 */
export const BASELINE_TYPE_COUNT = 4;

/**
 * Living Map view (THINK-320 U6): the schema-graph canvas (self-fetching
 * @thinkwork/graph OntologyGraph) at full content width, with the review
 * queue behind a badged inbox icon in the PAGE HEADER (published to
 * SettingsMemoryHome via `onHeaderControllerChange`, next to "+ Add
 * triple") that opens it as a slide-over sheet — the same Explorer-style
 * Sheet that hosts the evidence panel and the
 * shared triple form (one back-stack: queue → evidence → edit form). The
 * queue reads a typed copy of the same ontologySchemaGraph feed; canvas
 * ghost overflow (R18) surfaces as the queue's banner inside the sheet.
 *
 * U7 additions: a dismissible day-one "install a starter pack" callout for
 * fresh tenants (R12) and an `initialFocus` handoff so a pack install lands
 * directly in the review flow (AE4).
 */
export function OntologyMapView({
  initialFocus = null,
  onInitialFocusConsumed,
  onOpenPacks,
  onHeaderControllerChange,
}: {
  /** Open the sheet on this focus at mount (pack-install handoff, AE4). */
  initialFocus?: OntologyFocus | null;
  /** Fired once the initial focus has been captured into the sheet stack. */
  onInitialFocusConsumed?: () => void;
  /** Navigate to the starter-pack browser (day-one callout, R12). */
  onOpenPacks?: () => void;
  /** Publish the header actions (add-triple + badged queue icon) upward. */
  onHeaderControllerChange?: (
    controller: OntologyMapHeaderController | null,
  ) => void;
} = {}) {
  const { tenantId, userId } = useTenant();
  const effectiveTenantId = tenantId ?? null;
  const graphRef = useRef<OntologyGraphHandle>(null);
  const [overflowCount, setOverflowCount] = useState(0);
  const [stack, setStack] = useState<SheetEntry[]>(() =>
    initialFocus ? [{ kind: "focus", focus: initialFocus }] : [],
  );
  const calloutDismissed = usePackCalloutDismissed(
    userId ?? null,
    effectiveTenantId,
  );

  // --- Toolbar search + facet filters (Memory/Wiki graph parity). Search
  // and filters DIM non-matching nodes in place (R3) — never remove nodes
  // or restart the simulation. The graph reports its candidate origins via
  // `onOriginsLoaded`; a headless filter table stores the selections,
  // forwarded to OntologyGraph's facet-filter props.
  const [searchQuery, setSearchQuery] = useState("");
  const [graphOrigins, setGraphOrigins] = useState<string[]>([]);
  const [filterColumnFilters, setFilterColumnFilters] =
    useState<ColumnFiltersState>([]);
  const facetColumns: DataTableTokenFilterColumn[] = useMemo(
    () => [
      {
        id: "status",
        label: "Status",
        type: "option",
        icon: <BadgeCheck className="size-4" />,
        options: [
          { value: "approved", label: "Approved" },
          { value: "proposed", label: "Proposed" },
        ],
      },
      {
        id: "origin",
        label: "Origin",
        type: "option",
        icon: <Compass className="size-4" />,
        options: graphOrigins.map((value) => ({
          value,
          label: ontologyOriginLabel(value),
        })),
      },
      {
        id: "evidence",
        label: "Evidence",
        type: "option",
        icon: <FileText className="size-4" />,
        options: [
          { value: "has_evidence", label: "Has evidence" },
          { value: "none", label: "None" },
        ],
      },
      {
        id: "activity",
        label: "Activity",
        type: "option",
        icon: <Activity className="size-4" />,
        options: [
          { value: "has_instances", label: "Has instances" },
          { value: "empty", label: "Empty" },
        ],
      },
    ],
    [graphOrigins],
  );
  const filterColumns: ColumnDef<Record<string, string>>[] = useMemo(
    () =>
      ["status", "origin", "evidence", "activity"].map((id) => ({
        id,
        accessorFn: (row: Record<string, string>) => row[id] ?? "",
        filterFn: dataTableTokenFilterFns.option,
      })),
    [],
  );
  const filterTable = useReactTable({
    data: [] as Record<string, string>[],
    columns: filterColumns,
    state: { columnFilters: filterColumnFilters },
    onColumnFiltersChange: setFilterColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const selectedColumnValues = useCallback(
    (id: string) => {
      const raw = filterColumnFilters.find((c) => c.id === id)?.value as
        | { value?: unknown }
        | undefined;
      const v = raw?.value;
      const arr = Array.isArray(v) ? v : v != null ? [v] : [];
      return arr.filter((x): x is string => typeof x === "string");
    },
    [filterColumnFilters],
  );
  const selectedStatuses = useMemo(
    () => selectedColumnValues("status"),
    [selectedColumnValues],
  );
  const selectedOrigins = useMemo(
    () => selectedColumnValues("origin"),
    [selectedColumnValues],
  );
  const selectedEvidence = useMemo(
    () => selectedColumnValues("evidence"),
    [selectedColumnValues],
  );
  const selectedActivity = useMemo(
    () => selectedColumnValues("activity"),
    [selectedColumnValues],
  );

  // The initial focus is captured into the sheet stack's initial state; tell
  // the host so a later remount of this view doesn't re-open the sheet.
  useEffect(() => {
    if (initialFocus) onInitialFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [railResult, reexecuteRail] = useQuery({
    query: SettingsOntologySchemaGraphQuery,
    variables: { tenantId: effectiveTenantId ?? "" },
    pause: !effectiveTenantId,
  });

  const graph = railResult.data?.ontologySchemaGraph ?? null;
  const candidates = useMemo(
    () =>
      (graph?.candidates ?? []).filter(
        (candidate) =>
          candidate.status === OntologyChangeSetStatus.PendingReview,
      ),
    [graph],
  );

  /** Refetch both readers of the schema-graph feed after any decision. */
  const refreshAll = useCallback(() => {
    graphRef.current?.refetch();
    reexecuteRail({ requestPolicy: "network-only" });
  }, [reexecuteRail]);

  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  const push = (entry: SheetEntry) =>
    setStack((current) => [...current, entry]);
  const pop = () => setStack((current) => current.slice(0, -1));
  const closeSheet = () => setStack([]);

  // Queue rows push onto the stack so the evidence view's Back returns to
  // the queue sheet.
  const openCandidate = (candidate: OntologyRailCandidate) => {
    push({
      kind: "focus",
      focus: {
        kind: "candidate",
        itemId: candidate.itemId,
        changeSetId: candidate.changeSetId,
        label: ontologyCandidateLabel(candidate),
      },
    });
  };

  const onNodeClick = useCallback((node: OntologyGraphNode) => {
    if (node.kind === "candidate" && node.itemId && node.changeSetId) {
      setStack([
        {
          kind: "focus",
          focus: {
            kind: "candidate",
            itemId: node.itemId,
            changeSetId: node.changeSetId,
            label: node.label,
          },
        },
      ]);
    } else if (node.kind === "type" && node.slug) {
      setStack([
        {
          kind: "focus",
          focus: { kind: "type", slug: node.slug, name: node.label },
        },
      ]);
    }
  }, []);

  // Existing types selectable on either end of a new triple, plus the
  // slug universe for the client-side R14 precheck (approved + pending).
  const typeOptions = useMemo(
    () =>
      (graph?.types ?? []).map((type) => ({
        slug: type.slug,
        name: type.name,
      })),
    [graph],
  );
  const existingSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const type of graph?.types ?? [])
      slugs.add(ontologySlugify(type.slug));
    for (const relationship of graph?.relationships ?? []) {
      slugs.add(ontologySlugify(relationship.slug));
    }
    for (const candidate of candidates) {
      if (candidate.slug) slugs.add(ontologySlugify(candidate.slug));
    }
    return slugs;
  }, [graph, candidates]);

  const pendingCount = candidates.length;

  // Publish the header actions to the page-header owner (SettingsMemoryHome
  // renders them at the far right of the top bar, like every other settings
  // page). Same lifecycle as SettingsMemory's refresh controller: re-publish
  // when the pending count changes, clear on unmount.
  useEffect(() => {
    if (!onHeaderControllerChange) return;
    onHeaderControllerChange({
      pendingCount,
      openAddTriple: () => setStack([{ kind: "form", editItem: null }]),
      openQueue: () => setStack([{ kind: "queue" }]),
    });
    return () => onHeaderControllerChange(null);
  }, [onHeaderControllerChange, pendingCount]);

  if (!effectiveTenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  const selectedItemId =
    top?.kind === "focus" && top.focus.kind === "candidate"
      ? top.focus.itemId
      : null;

  // Day-one nudge (R12): only the 4 baseline types, nothing pending, and
  // this admin hasn't dismissed it. Informational — never blocking.
  const showPackCallout =
    graph != null &&
    graph.types.length <= BASELINE_TYPE_COUNT &&
    candidates.length === 0 &&
    !calloutDismissed;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <OntologyToolbarSearch
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
        />
        <DataTableTokenFilter
          table={filterTable}
          columns={facetColumns}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full [&_[data-token-filter-token]]:shrink-0"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
      </div>
      <div className="border-border relative min-h-0 w-full flex-1 overflow-hidden rounded-lg border">
        <OntologyGraph
          loadingFallback={
            <div className="flex h-full min-h-48 items-center justify-center">
              <LoadingShimmer />
            </div>
          }
          ref={graphRef}
          tenantId={effectiveTenantId}
          searchQuery={searchQuery || undefined}
          statusFilter={selectedStatuses.length ? selectedStatuses : undefined}
          originFilter={selectedOrigins.length ? selectedOrigins : undefined}
          evidenceFilter={
            selectedEvidence.length ? selectedEvidence : undefined
          }
          activityFilter={
            selectedActivity.length ? selectedActivity : undefined
          }
          onOriginsLoaded={setGraphOrigins}
          onNodeClick={onNodeClick}
          onCandidateOverflow={setOverflowCount}
        />
        {showPackCallout ? (
          <div
            role="status"
            className="border-border bg-background/95 absolute bottom-3 left-3 right-3 z-30 flex items-start gap-3 rounded-lg border p-4 shadow-sm sm:right-auto sm:max-w-md"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Give your map a head start</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Your schema only has the baseline types so far. Install a
                starter pack to stage reviewable structure for your domain.
              </p>
              {onOpenPacks ? (
                <Button size="sm" className="mt-3" onClick={onOpenPacks}>
                  Browse starter packs
                </Button>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss starter pack suggestion"
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={() =>
                dismissPackCallout(userId ?? null, effectiveTenantId)
              }
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <Sheet
        open={stack.length > 0}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      >
        <SheetContent className="flex flex-col sm:max-w-lg">
          {top?.kind === "queue" ? (
            <div className="flex min-h-0 flex-1 flex-col p-6">
              <OntologyReviewRail
                candidates={candidates}
                loading={railResult.fetching && !railResult.data}
                error={railResult.error?.message ?? null}
                overflowCount={overflowCount}
                selectedItemId={selectedItemId}
                onSelect={openCandidate}
              />
            </div>
          ) : top?.kind === "focus" ? (
            <OntologyCandidateSheet
              tenantId={effectiveTenantId}
              focus={top.focus}
              historyDepth={stack.length - 1}
              onBack={pop}
              onEdit={(item) => push({ kind: "form", editItem: item })}
              onFocusType={(focus) => push({ kind: "focus", focus })}
              onActionComplete={() => {
                refreshAll();
                closeSheet();
              }}
            />
          ) : top?.kind === "form" ? (
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="mb-4 text-base font-semibold">
                {top.editItem ? "Edit candidate" : "Add a triple"}
              </h3>
              <OntologyTripleForm
                tenantId={effectiveTenantId}
                editItem={top.editItem}
                typeOptions={typeOptions}
                existingSlugs={existingSlugs}
                onSaved={() => {
                  refreshAll();
                  closeSheet();
                }}
                onRefresh={refreshAll}
                onCancel={stack.length > 1 ? pop : closeSheet}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
