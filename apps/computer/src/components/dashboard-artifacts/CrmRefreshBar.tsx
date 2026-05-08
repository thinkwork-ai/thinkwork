import { useState } from "react";
import { Brain, RefreshCcw } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import { formatDateTime } from "@/components/dashboard-artifacts/dashboard-data";
import {
  RefreshStateTimeline,
  type RefreshState,
} from "@/components/dashboard-artifacts/RefreshStateTimeline";

interface CrmRefreshBarProps {
  manifest: DashboardArtifactManifest;
  initialState?: RefreshState;
}

export function CrmRefreshBar({
  manifest,
  initialState = "available",
}: CrmRefreshBarProps) {
  const [refreshState, setRefreshState] = useState<RefreshState>(initialState);
  const isActive = refreshState === "queued" || refreshState === "running";

  function startRefresh() {
    if (isActive) return;
    setRefreshState("queued");
    window.setTimeout(() => setRefreshState("running"), 250);
    window.setTimeout(() => setRefreshState("succeeded"), 750);
  }

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Refresh recipe</h3>
            <Badge variant="outline" className="rounded-md">
              v{manifest.refresh.recipeVersion}
            </Badge>
            <RefreshStateBadge state={refreshState} />
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Refresh re-runs saved source queries, deterministic transforms,
            scoring, charts, and templated summaries. It does not reinterpret the
            business question or mutate CRM, email, or calendar data.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Last refreshed {formatDateTime(manifest.refresh.lastRefreshAt)}. Next
            allowed {formatDateTime(manifest.refresh.nextAllowedAt)}.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={isActive}
            onClick={startRefresh}
          >
            <RefreshCcw className={isActive ? "size-4 animate-spin" : "size-4"} />
            {isActive ? "Refreshing" : "Refresh"}
          </Button>
          <Button asChild size="sm" className="gap-2">
            <a href={`/computer?artifact=${manifest.snapshot.artifactId}`}>
              <Brain className="size-4" />
              Ask Computer
            </a>
          </Button>
        </div>
      </div>
      <RefreshStateTimeline state={refreshState} />
    </section>
  );
}

function RefreshStateBadge({ state }: { state: RefreshState }) {
  const label =
    state === "available"
      ? "Refresh available"
      : state === "queued"
        ? "Queued"
        : state === "running"
          ? "Running"
          : state === "partial"
            ? "Partial success"
            : state === "failed"
              ? "Failed"
              : "Succeeded";

  return (
    <Badge
      variant={state === "failed" ? "destructive" : "secondary"}
      className="rounded-md"
    >
      {label}
    </Badge>
  );
}
