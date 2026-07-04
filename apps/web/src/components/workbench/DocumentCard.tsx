/**
 * HTML Document Artifacts (THINK-147 U6): the compact in-thread document card.
 *
 * The thread never carries document bodies (R4) — only this card, folded from
 * the `document.card` thread_turn_events payload. It links to the full-height
 * reader at /artifacts/$id.
 */

import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";

export interface DocumentCardData {
  artifactId: string;
  title: string;
  genre?: string;
  abstract?: string;
  status?: string;
  headVersion?: number;
}

export function DocumentCard({ card }: { card: DocumentCardData }) {
  const statusLabel =
    card.status === "final"
      ? `Final${card.headVersion ? ` · v${card.headVersion}` : ""}`
      : "Draft";
  return (
    <Link
      to="/artifacts/$id"
      params={{ id: card.artifactId }}
      className="not-prose group my-1 flex w-full max-w-xl items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
      data-testid="document-card"
    >
      <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground group-hover:text-foreground">
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {card.title}
          </span>
          {card.genre ? (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {card.genre}
            </span>
          ) : null}
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {statusLabel}
          </span>
        </div>
        {card.abstract ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {card.abstract}
          </p>
        ) : null}
        <span className="mt-1 inline-block text-xs font-medium text-primary">
          Open document →
        </span>
      </div>
    </Link>
  );
}
