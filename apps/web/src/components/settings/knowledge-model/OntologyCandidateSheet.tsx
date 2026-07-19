import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  Badge,
  Button,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import {
  OntologyChangeSetStatus,
  OntologyExcludedItemDisposition,
  type SettingsOntologyChangeSetsQuery as SettingsOntologyChangeSetsData,
} from "@/gql/graphql";
import {
  SettingsApproveOntologyChangeSetMutation,
  SettingsKnowledgeGraphOntologyQuery,
  SettingsOntologyChangeSetsQuery,
  SettingsRejectOntologyChangeSetItemMutation,
} from "@/lib/settings-queries";
import type { OntologyEditableItem } from "./OntologyTripleForm";

export type OntologyFocus =
  | { kind: "candidate"; itemId: string; changeSetId: string; label: string }
  | { kind: "type"; slug: string; name: string };

type ChangeSet = SettingsOntologyChangeSetsData["ontologyChangeSets"][number];
type ChangeSetItem = ChangeSet["items"][number];

/** AWSJSON dual wire shape (THINK-188): object via Yoga, string via AppSync. */
function parseAwsJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function effectiveValue(item: ChangeSetItem): Record<string, unknown> {
  const edited = parseAwsJson(item.editedValue);
  return Object.keys(edited).length > 0
    ? edited
    : parseAwsJson(item.proposedValue);
}

const SETTLED_ITEM_STATUSES = new Set<OntologyChangeSetStatus>([
  OntologyChangeSetStatus.Approved,
  OntologyChangeSetStatus.Applied,
]);

/**
 * Evidence panel of the Living Map (THINK-320 U6), mirroring
 * KnowledgeGraphEntitySheet: rendered inside the host-owned Sheet with a
 * back-stack. Candidate focus shows verbatim evidence quotes plus
 * approve / edit / reject (R5, AE2); approved-type focus shows the
 * definition and its founding evidence (R6), with a provenance line for
 * pack/baseline types that carry no stored quotes.
 */
export function OntologyCandidateSheet({
  tenantId,
  focus,
  historyDepth = 0,
  onBack,
  onEdit,
  onActionComplete,
}: {
  tenantId: string;
  focus: OntologyFocus;
  historyDepth?: number;
  onBack?: () => void;
  /** Push the candidate into the shared form editor (KTD-9). */
  onEdit: (item: OntologyEditableItem) => void;
  /** Approve/reject landed — the host refreshes map + rail and closes. */
  onActionComplete: () => void;
}) {
  const [result] = useQuery({
    query: SettingsOntologyChangeSetsQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [definitionsResult] = useQuery({
    query: SettingsKnowledgeGraphOntologyQuery,
    variables: { tenantId },
    pause: !tenantId || focus.kind !== "type",
  });

  const loading = result.fetching && !result.data;
  const changeSets = result.data?.ontologyChangeSets ?? [];

  const backButton =
    historyDepth > 0 && onBack ? (
      <button
        type="button"
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground -ml-1 mr-1"
        aria-label="Back"
      >
        <ArrowLeft className="size-4" />
      </button>
    ) : null;

  if (focus.kind === "type") {
    return (
      <TypeFocus
        focus={focus}
        changeSets={changeSets}
        definitions={definitionsResult.data?.ontologyDefinitions ?? null}
        loading={
          loading || (definitionsResult.fetching && !definitionsResult.data)
        }
        backButton={backButton}
      />
    );
  }

  const changeSet = changeSets.find((set) => set.id === focus.changeSetId);
  const item = changeSet?.items.find((entry) => entry.id === focus.itemId);

  return (
    <>
      <SheetHeader className="p-6 pb-0">
        <SheetTitle className="flex items-center gap-2">
          {backButton}
          <span className="truncate">
            {item
              ? String(effectiveValue(item).name ?? item.title)
              : focus.label}
          </span>
          <Badge variant="outline" className="shrink-0 font-normal">
            proposed
          </Badge>
        </SheetTitle>
        <SheetDescription>
          {item
            ? `${item.itemType.toLowerCase().replace(/_/g, " ")} · ${item.evidenceExamples.length} evidence · ${changeSet?.proposedBy === "suggestion_engine" ? "suggested by scans" : `proposed by ${changeSet?.proposedBy ?? "unknown"}`}`
            : "Pending candidate"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 pt-4">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading candidate...
          </div>
        ) : result.error ? (
          <p className="text-muted-foreground text-sm">
            {result.error.message}
          </p>
        ) : !item || !changeSet ? (
          <p className="text-muted-foreground text-sm">
            This candidate is no longer pending — it may have been decided
            elsewhere.
          </p>
        ) : (
          <CandidateFocus
            tenantId={tenantId}
            changeSet={changeSet}
            item={item}
            onEdit={onEdit}
            onActionComplete={onActionComplete}
          />
        )}
      </div>
    </>
  );
}

function CandidateFocus({
  tenantId,
  changeSet,
  item,
  onEdit,
  onActionComplete,
}: {
  tenantId: string;
  changeSet: ChangeSet;
  item: ChangeSetItem;
  onEdit: (item: OntologyEditableItem) => void;
  onActionComplete: () => void;
}) {
  const [, approveChangeSet] = useMutation(
    SettingsApproveOntologyChangeSetMutation,
  );
  const [, rejectItem] = useMutation(
    SettingsRejectOntologyChangeSetItemMutation,
  );
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const value = effectiveValue(item);
  const evidence = item.evidenceExamples;

  /**
   * Single-candidate approve rides the R15 per-item mechanism: approve the
   * owning change set with every OTHER still-pending item excluded as
   * DEFERRED, so only this candidate lands in the minted version and the
   * rest stay reviewable.
   */
  const approve = async () => {
    if (submitting) return;
    setSubmitting("approve");
    setError(null);
    try {
      const excludedItemIds = changeSet.items
        .filter(
          (entry) =>
            entry.id !== item.id && !SETTLED_ITEM_STATUSES.has(entry.status),
        )
        .map((entry) => entry.id);
      const result = await approveChangeSet({
        input: {
          tenantId,
          changeSetId: changeSet.id,
          excludedItemIds,
          excludedDisposition: OntologyExcludedItemDisposition.Deferred,
        },
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      onActionComplete();
    } finally {
      setSubmitting(null);
    }
  };

  /** Item-level reject (R13): writes the rejection fingerprint server-side. */
  const reject = async () => {
    if (submitting) return;
    setSubmitting("reject");
    setError(null);
    try {
      const result = await rejectItem({
        input: { tenantId, itemId: item.id },
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      onActionComplete();
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <>
      {typeof value.description === "string" && value.description ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {value.description}
        </p>
      ) : item.description ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {item.description}
        </p>
      ) : null}

      {Array.isArray(value.sourceTypeSlugs) ||
      Array.isArray(value.targetTypeSlugs) ? (
        <p className="text-muted-foreground text-sm">
          {((value.sourceTypeSlugs as string[]) ?? []).join(", ") || "any"} →{" "}
          {String(value.name ?? item.targetSlug ?? "")} →{" "}
          {((value.targetTypeSlugs as string[]) ?? []).join(", ") || "any"}
        </p>
      ) : null}

      <section>
        <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
          Evidence ({evidence.length})
        </h4>
        {evidence.length > 0 ? (
          <div className="space-y-2">
            {evidence.slice(0, 12).map((entry) => (
              <div
                key={entry.id}
                className="border-border bg-muted/20 rounded-md border px-3 py-2"
              >
                <p className="text-sm leading-relaxed">{entry.quote}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {entry.sourceLabel ?? entry.sourceKind}
                  {entry.observedAt ? ` · ${formatDate(entry.observedAt)}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No stored evidence for this candidate yet.
          </p>
        )}
      </section>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pb-6">
        <Button size="sm" disabled={submitting !== null} onClick={approve}>
          {submitting === "approve" ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
          ) : null}
          Approve
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={submitting !== null}
          onClick={() =>
            onEdit({
              id: item.id,
              changeSetId: changeSet.id,
              itemType: item.itemType,
              updatedAt: item.updatedAt,
              value,
            })
          }
        >
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={submitting !== null}
          onClick={reject}
        >
          {submitting === "reject" ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
          ) : null}
          Reject
        </Button>
      </div>
    </>
  );
}

function TypeFocus({
  focus,
  changeSets,
  definitions,
  loading,
  backButton,
}: {
  focus: Extract<OntologyFocus, { kind: "type" }>;
  changeSets: ChangeSet[];
  definitions: {
    entityTypes: Array<{
      slug: string;
      name: string;
      description?: string | null;
      broadType: string;
      aliases: string[];
    }>;
    relationshipTypes: Array<{
      slug: string;
      name: string;
      description?: string | null;
      sourceTypeSlugs: string[];
      targetTypeSlugs: string[];
      aliases: string[];
    }>;
  } | null;
  loading: boolean;
  backButton: React.ReactNode;
}) {
  const entityType = definitions?.entityTypes.find(
    (type) => type.slug === focus.slug,
  );
  const relationshipType = definitions?.relationshipTypes.find(
    (type) => type.slug === focus.slug,
  );
  const definition = entityType ?? relationshipType ?? null;

  // Founding evidence (R6): quotes stored on the settled change-set item
  // that admitted this slug into the ontology.
  const foundingEvidence = changeSets
    .filter(
      (set) =>
        set.status === OntologyChangeSetStatus.Approved ||
        set.status === OntologyChangeSetStatus.Applied,
    )
    .flatMap((set) =>
      set.items
        .filter(
          (item) =>
            SETTLED_ITEM_STATUSES.has(item.status) &&
            (item.targetSlug ?? parseAwsJson(item.proposedValue).slug) ===
              focus.slug,
        )
        .flatMap((item) => item.evidenceExamples),
    );

  return (
    <>
      <SheetHeader className="p-6 pb-0">
        <SheetTitle className="flex items-center gap-2">
          {backButton}
          <span className="truncate">
            {(definition?.name as string | undefined) ?? focus.name}
          </span>
          <Badge variant="default" className="shrink-0 font-normal">
            approved
          </Badge>
        </SheetTitle>
        <SheetDescription>
          {entityType
            ? `Entity type · ${entityType.broadType}`
            : relationshipType
              ? "Relationship type"
              : "Approved definition"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 pt-4">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading definition...
          </div>
        ) : (
          <>
            {definition?.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {definition.description}
              </p>
            ) : null}

            {relationshipType ? (
              <p className="text-muted-foreground text-sm">
                {relationshipType.sourceTypeSlugs.join(", ") || "any"} →{" "}
                {relationshipType.name} →{" "}
                {relationshipType.targetTypeSlugs.join(", ") || "any"}
              </p>
            ) : null}

            {definition && definition.aliases.length > 0 ? (
              <section>
                <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
                  Aliases
                </h4>
                <div className="flex flex-wrap gap-1">
                  {definition.aliases.map((alias) => (
                    <Badge
                      key={alias}
                      variant="outline"
                      className="font-normal"
                    >
                      {alias}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
                Founding evidence
              </h4>
              {foundingEvidence.length > 0 ? (
                <div className="space-y-2">
                  {foundingEvidence.slice(0, 12).map((entry) => (
                    <div
                      key={entry.id}
                      className="border-border bg-muted/20 rounded-md border px-3 py-2"
                    >
                      <p className="text-sm leading-relaxed">{entry.quote}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {entry.sourceLabel ?? entry.sourceKind}
                        {entry.observedAt
                          ? ` · ${formatDate(entry.observedAt)}`
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p
                  className="text-muted-foreground text-sm"
                  data-testid="provenance-line"
                >
                  Installed from a pack or the platform baseline — no founding
                  evidence was recorded for this definition.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
