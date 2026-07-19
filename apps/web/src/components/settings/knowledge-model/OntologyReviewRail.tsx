import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import type { SettingsOntologySchemaGraphQuery as SettingsOntologySchemaGraphData } from "@/gql/graphql";

export type OntologyRailCandidate =
  SettingsOntologySchemaGraphData["ontologySchemaGraph"]["candidates"][number];

/**
 * Page size mirrors the canvas's 30-ghost cap (R18): the first rail page
 * covers exactly what the map can show, and paging continues past it so
 * every candidate stays reachable even when the canvas overflows.
 */
export const RAIL_PAGE_SIZE = 30;

/**
 * AWSJSON dual wire shape (THINK-188): objects via Yoga, JSON strings via
 * AppSync — accept both.
 */
function parseCandidateValue(value: unknown): Record<string, unknown> {
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

export function ontologyCandidateLabel(candidate: OntologyRailCandidate) {
  const value = {
    ...parseCandidateValue(candidate.proposedValue),
    ...parseCandidateValue(candidate.editedValue),
  };
  return (
    (typeof value.name === "string" && value.name) ||
    candidate.slug ||
    "Proposed change"
  );
}

function formatItemType(itemType: string) {
  return itemType.toLowerCase().replace(/_/g, " ");
}

/**
 * Review rail of the Living Map (THINK-320 U6, R4): one row per pending
 * candidate item from the same ontologySchemaGraph feed the canvas renders.
 * Mirrors ResolutionQueue's list pattern. Content only — the split layout
 * is owned by OntologyMapView.
 */
export function OntologyReviewRail({
  candidates,
  loading,
  error,
  overflowCount,
  selectedItemId,
  onSelect,
}: {
  candidates: OntologyRailCandidate[];
  loading: boolean;
  error: string | null;
  /** R18: renderable ghosts that did not fit under the canvas cap. */
  overflowCount: number;
  selectedItemId?: string | null;
  onSelect: (candidate: OntologyRailCandidate) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(RAIL_PAGE_SIZE);
  const visible = candidates.slice(0, visibleCount);
  const remaining = candidates.length - visible.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Review queue</h3>
        <span className="text-muted-foreground text-xs">
          {candidates.length} pending
        </span>
      </div>

      {overflowCount > 0 ? (
        <p
          role="status"
          className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
        >
          {overflowCount} proposal{overflowCount === 1 ? "" : "s"} beyond the
          map&apos;s ghost cap — every candidate is listed here.
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive mb-2 text-sm" role="alert">
          Failed to load candidates: {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading candidates...
          </div>
        ) : candidates.length === 0 ? (
          <div className="text-muted-foreground rounded-md border p-4 text-sm">
            Nothing waiting for review. New candidates appear here when
            suggestion scans land or a teammate authors a triple.
          </div>
        ) : (
          <>
            <ul className="space-y-2" aria-label="Pending ontology candidates">
              {visible.map((candidate) => (
                <li key={candidate.itemId}>
                  <button
                    type="button"
                    aria-pressed={selectedItemId === candidate.itemId}
                    onClick={() => onSelect(candidate)}
                    className={`hover:bg-muted/50 focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 ${
                      selectedItemId === candidate.itemId
                        ? "bg-primary/10 border-primary/40"
                        : ""
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {ontologyCandidateLabel(candidate)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {formatItemType(candidate.itemType)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {candidate.evidenceCount} evidence
                      </Badge>
                      <span className="text-muted-foreground text-[10px]">
                        {candidate.origin === "suggestion_engine"
                          ? "suggested"
                          : candidate.origin}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {remaining > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() =>
                  setVisibleCount((count) => count + RAIL_PAGE_SIZE)
                }
              >
                Show {Math.min(remaining, RAIL_PAGE_SIZE)} more ({remaining}{" "}
                remaining)
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
