/**
 * HTML Document Artifacts (THINK-147 U6): the compact in-thread document card.
 *
 * The thread never carries document bodies (R4) — only this card, folded from
 * the `document.card` thread_turn_events payload. It links to the full-height
 * reader at /artifacts/$id. Rendering delegates to the shared ArtifactCard
 * (THINK-166 U3) so documents and other artifact emissions share one pattern.
 */

import { ArtifactCard } from "@/components/artifacts/ArtifactCard";

export interface DocumentCardData {
  artifactId: string;
  title: string;
  genre?: string;
  abstract?: string;
  status?: string;
  headVersion?: number;
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
  return (
    <ArtifactCard
      artifact={{ id: card.artifactId, title: card.title }}
      badge={card.genre ?? null}
      statusLabel={statusLabel}
      description={card.abstract}
      testId="document-card"
      onOpen={onOpen}
    />
  );
}
