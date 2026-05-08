import { Brain, RefreshCcw } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import { formatDateTime } from "@/components/dashboard-artifacts/dashboard-data";

interface CrmRefreshBarProps {
  manifest: DashboardArtifactManifest;
}

export function CrmRefreshBar({ manifest }: CrmRefreshBarProps) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Refresh recipe</h3>
          <Badge variant="outline" className="rounded-md">
            v{manifest.refresh.recipeVersion}
          </Badge>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Refresh re-runs saved source queries, deterministic transforms, scoring,
          charts, and templated summaries. It does not reinterpret the business
          question or mutate CRM, email, or calendar data.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Last refreshed {formatDateTime(manifest.refresh.lastRefreshAt)}. Next
          allowed {formatDateTime(manifest.refresh.nextAllowedAt)}.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <RefreshCcw className="size-4" />
          Refresh
        </Button>
        <Button type="button" size="sm" className="gap-2">
          <Brain className="size-4" />
          Ask Computer
        </Button>
      </div>
    </section>
  );
}
