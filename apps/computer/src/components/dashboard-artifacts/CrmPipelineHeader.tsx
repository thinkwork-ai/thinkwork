import { CalendarClock, ShieldCheck } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import { formatDateTime } from "@/components/dashboard-artifacts/dashboard-data";

interface CrmPipelineHeaderProps {
  manifest: DashboardArtifactManifest;
}

export function CrmPipelineHeader({ manifest }: CrmPipelineHeaderProps) {
  return (
    <header className="flex flex-col gap-4 rounded-lg border border-border/70 bg-background p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-md">
            Pipeline risk
          </Badge>
          <Badge variant="outline" className="rounded-md">
            Read-only
          </Badge>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-emerald-500" />
            Private artifact
          </span>
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          {manifest.snapshot.title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {manifest.snapshot.summary}
        </p>
      </div>
      <div className="shrink-0 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarClock className="size-4" />
          As of
        </div>
        <p className="mt-1 font-medium">{formatDateTime(manifest.snapshot.generatedAt)}</p>
      </div>
    </header>
  );
}
