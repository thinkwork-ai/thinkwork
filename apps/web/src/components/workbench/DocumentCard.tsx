/**
 * HTML Document Artifacts (THINK-147 U6): the compact in-thread document card.
 *
 * The thread never carries document bodies (R4) — only this card, folded from
 * the `document.card` thread_turn_events payload. It links to the full-height
 * reader at /artifacts/$id. Rendering delegates to the shared ArtifactCard
 * (THINK-166 U3) so documents and other artifact emissions share one pattern.
 */

import { ArtifactCard } from "@/components/artifacts/ArtifactCard";

/** One tw:sources provenance entry carried on the document card. */
export interface DocumentCardSourceEntry {
  kind: "tool" | "none";
  tool?: string;
  detail?: string;
}

/** Per-section contract outcome + provenance from the emission card payload. */
export interface DocumentCardSection {
  id: string;
  title: string;
  tier?: string;
  status?: string;
  sources?: DocumentCardSourceEntry[];
}

export interface DocumentCardData {
  artifactId: string;
  /** Logical document id — self-heal key when artifactId no longer resolves. */
  documentId?: string;
  title: string;
  genre?: string;
  abstract?: string;
  status?: string;
  headVersion?: number;
  /** Emission time of the folded document.card event — the card's freshness. */
  updatedAt?: string;
  /** Section outcomes + tw:sources provenance (manifest plates only). */
  sections?: DocumentCardSection[];
}

/** "tool-a, tool-b" / "narrative" summary for one section's sources line. */
function sourcesSummary(sources: DocumentCardSourceEntry[]): string {
  const parts = sources.map((source) =>
    source.kind === "none" ? "narrative" : (source.tool ?? "tool"),
  );
  return [...new Set(parts)].join(", ");
}

export function DocumentCard({
  card,
  onOpen,
}: {
  card: DocumentCardData;
  /** THINK-168: open in the thread's docked panel (primary click). */
  onOpen?: () => void;
}) {
  const statusLabel =
    card.status === "final"
      ? `Final${card.headVersion ? ` · v${card.headVersion}` : ""}`
      : "Draft";
  const sourcedSections = (card.sections ?? []).filter(
    (section) => (section.sources?.length ?? 0) > 0,
  );
  return (
    <div>
      <ArtifactCard
        artifact={{
          id: card.artifactId,
          title: card.title,
          updatedAt: card.updatedAt ?? null,
        }}
        badge={card.genre ?? null}
        statusLabel={statusLabel}
        testId="document-card"
        onOpen={onOpen}
      />
      {sourcedSections.length > 0 ? (
        <ul
          className="not-prose mt-0.5 space-y-0.5 pl-3"
          data-testid="document-card-sources"
        >
          {sourcedSections.map((section) => (
            <li
              key={section.id}
              className="truncate text-[10px] text-muted-foreground"
              title={(section.sources ?? [])
                .map((source) =>
                  source.kind === "none"
                    ? `narrative — ${source.detail ?? ""}`
                    : `${source.tool ?? "tool"}${source.detail ? ` — ${source.detail}` : ""}`,
                )
                .join("\n")}
            >
              {section.title} · Sources: {sourcesSummary(section.sources ?? [])}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
