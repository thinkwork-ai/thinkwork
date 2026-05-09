import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Brain, RefreshCcw } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import type {
  DashboardArtifactManifest,
  DashboardArtifactRefreshTask,
} from "@/lib/app-artifacts";
import { formatDateTime } from "@/components/dashboard-artifacts/dashboard-data";
import {
  RefreshStateTimeline,
  type RefreshState,
} from "@/components/dashboard-artifacts/RefreshStateTimeline";

interface CrmRefreshBarProps {
  manifest: DashboardArtifactManifest;
  latestRefreshTask?: DashboardArtifactRefreshTask | null;
  canRefresh?: boolean;
  initialState?: RefreshState;
  onRefresh?: () => Promise<DashboardArtifactRefreshTask | null | undefined>;
  onRefreshSettled?: () => void;
}

export function CrmRefreshBar({
  manifest,
  latestRefreshTask,
  canRefresh = true,
  initialState = "available",
  onRefresh,
  onRefreshSettled,
}: CrmRefreshBarProps) {
  const [refreshState, setRefreshState] = useState<RefreshState>(
    refreshStateFromTask(latestRefreshTask) ?? initialState,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isActive = refreshState === "queued" || refreshState === "running";
  const refreshDisabled = isActive || !canRefresh || !onRefresh;

  useEffect(() => {
    const taskState = refreshStateFromTask(latestRefreshTask);
    if (taskState) setRefreshState(taskState);
  }, [
    latestRefreshTask?.id,
    latestRefreshTask?.status,
    latestRefreshTask?.updatedAt,
  ]);

  async function startRefresh() {
    if (refreshDisabled || !onRefresh) return;
    setSubmitError(null);
    setRefreshState("queued");
    try {
      const task = await onRefresh();
      setRefreshState(refreshStateFromTask(task) ?? "queued");
    } catch (err) {
      setRefreshState("failed");
      setSubmitError(
        err instanceof Error ? err.message : "Failed to start refresh",
      );
    } finally {
      onRefreshSettled?.();
    }
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
            disabled={refreshDisabled}
            onClick={startRefresh}
          >
            <RefreshCcw className={isActive ? "size-4 animate-spin" : "size-4"} />
            {isActive ? "Refreshing" : "Refresh"}
          </Button>
          <Button asChild size="sm" className="gap-2">
            <Link
              to="/new"
              search={{ artifact: manifest.snapshot.artifactId }}
            >
              <Brain className="size-4" />
              Ask Computer
            </Link>
          </Button>
        </div>
      </div>
      {submitError ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {submitError}
        </div>
      ) : null}
      <RefreshStateTimeline state={refreshState} />
    </section>
  );
}

export function refreshStateFromTask(
  task?: DashboardArtifactRefreshTask | null,
): RefreshState | null {
  const status = String(task?.status ?? "").toLowerCase();
  if (!status) return null;
  if (status === "pending") return "queued";
  if (status === "running") return "running";
  if (status === "completed") return "succeeded";
  if (status === "failed" || status === "cancelled") return "failed";
  return null;
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
