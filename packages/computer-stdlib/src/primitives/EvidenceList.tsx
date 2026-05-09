import { ExternalLink, FileSearch } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import { formatDateTime } from "../formatters/date.js";

export interface EvidenceItem {
  id: string;
  title: string;
  snippet?: string;
  sourceId?: string;
  fetchedAt?: string | Date;
  url?: string;
}

export interface EvidenceListProps {
  title?: string;
  description?: string;
  items: EvidenceItem[];
  emptyState?: string;
}

export function EvidenceList({
  title = "Evidence",
  description = "Signals used to support this applet.",
  items,
  emptyState = "No evidence attached yet.",
}: EvidenceListProps) {
  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      <div className="mb-4 flex items-center gap-2">
        <FileSearch className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
          {emptyState}
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-md border border-border/60 bg-muted/20 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h4 className="min-w-0 flex-1 text-sm font-medium">
                  {item.title}
                </h4>
                {item.sourceId ? (
                  <Badge variant="outline" className="rounded-md">
                    {item.sourceId}
                  </Badge>
                ) : null}
              </div>
              {item.snippet ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.snippet}
                </p>
              ) : null}
              {item.fetchedAt || item.url ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {item.fetchedAt ? (
                    <span>{formatDateTime(item.fetchedAt)}</span>
                  ) : null}
                  {item.url ? (
                    <a
                      href={item.url}
                      className="inline-flex items-center gap-1 text-primary"
                    >
                      Source
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
