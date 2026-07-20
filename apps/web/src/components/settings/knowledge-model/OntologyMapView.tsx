import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "urql";
import { Inbox, Plus, X } from "lucide-react";
import { Button, Sheet, SheetContent } from "@thinkwork/ui";
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

/**
 * The platform seeds every tenant with 4 baseline types (customer, person,
 * project, task). A tenant still at or under that count with nothing pending
 * has never grown its schema — the day-one pack callout's trigger (R12).
 */
export const BASELINE_TYPE_COUNT = 4;

/**
 * Living Map view (THINK-320 U6): the schema-graph canvas (self-fetching
 * @thinkwork/graph OntologyGraph) at full content width, with the review
 * queue behind a badged toolbar icon that opens it as a slide-over sheet —
 * the same Explorer-style Sheet that hosts the evidence panel and the
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
}: {
  /** Open the sheet on this focus at mount (pack-install handoff, AE4). */
  initialFocus?: OntologyFocus | null;
  /** Fired once the initial focus has been captured into the sheet stack. */
  onInitialFocusConsumed?: () => void;
  /** Navigate to the starter-pack browser (day-one callout, R12). */
  onOpenPacks?: () => void;
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

  if (!effectiveTenantId) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Loading tenant...
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

  const pendingCount = candidates.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* The map's toolbar (top-right of the Living Map header area): the
          add-triple gesture next to the badged review-queue trigger. */}
      <div className="mb-3 flex shrink-0 items-center justify-end gap-2">
        <Button
          size="sm"
          onClick={() => setStack([{ kind: "form", editItem: null }])}
        >
          <Plus className="mr-1 size-3.5" aria-hidden />
          Add triple
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="relative"
          aria-label={`Review queue (${pendingCount} pending)`}
          onClick={() => setStack([{ kind: "queue" }])}
        >
          <Inbox className="size-4" aria-hidden />
          {pendingCount > 0 ? (
            <span
              aria-hidden
              className="bg-primary text-primary-foreground absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none"
            >
              {pendingCount}
            </span>
          ) : null}
        </Button>
      </div>

      <div className="border-border relative min-h-0 w-full flex-1 overflow-hidden rounded-lg border">
        <OntologyGraph
          ref={graphRef}
          tenantId={effectiveTenantId}
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
