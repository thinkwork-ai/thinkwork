import { ExternalLink, FileSearch } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import { formatDateTime } from "@/components/dashboard-artifacts/dashboard-data";

interface CrmEvidenceDrawerProps {
  manifest: DashboardArtifactManifest;
}

export function CrmEvidenceDrawer({ manifest }: CrmEvidenceDrawerProps) {
  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      <div className="mb-4 flex items-center gap-2">
        <FileSearch className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Evidence</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Signals used to support the risk ranking.
          </p>
        </div>
      </div>
      <div className="grid gap-3">
        {manifest.evidence.map((item) => (
          <article
            key={item.id}
            className="rounded-md border border-border/60 bg-muted/20 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4 className="min-w-0 flex-1 text-sm font-medium">
                {item.title}
              </h4>
              <Badge variant="outline" className="rounded-md">
                {item.sourceId}
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {item.snippet}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{formatDateTime(item.fetchedAt)}</span>
              {"url" in item ? (
                <a
                  href={item.url}
                  className="inline-flex items-center gap-1 text-primary"
                >
                  Source
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
