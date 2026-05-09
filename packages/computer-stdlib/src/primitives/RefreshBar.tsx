import { AlertCircle, Brain, RefreshCcw } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { formatDateTime } from "../formatters/date.js";
import {
  RefreshStateTimeline,
  type RefreshState,
} from "./RefreshStateTimeline.js";
import {
  SourceStatusList,
  type SourceStatus,
  type SourceStatusItem,
} from "./SourceStatusList.js";

export interface RefreshBarProps {
  title?: string;
  description?: string;
  recipeVersion?: string | number;
  lastRefreshAt?: string | Date;
  nextAllowedAt?: string | Date;
  refreshState?: RefreshState;
  sourceStatuses?: Record<string, SourceStatus>;
  disabled?: boolean;
  error?: string | null;
  onRefresh?: () => void | Promise<void>;
  onAskComputer?: () => void;
}

export function RefreshBar({
  title = "Refresh recipe",
  description = "Refresh re-runs saved source queries and deterministic transforms. It does not reinterpret the business question or mutate external systems.",
  recipeVersion,
  lastRefreshAt,
  nextAllowedAt,
  refreshState = "available",
  sourceStatuses,
  disabled = false,
  error,
  onRefresh,
  onAskComputer,
}: RefreshBarProps) {
  const isActive = refreshState === "queued" || refreshState === "running";
  const refreshDisabled = isActive || !onRefresh;

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {recipeVersion != null ? (
              <Badge variant="outline" className="rounded-md">
                v{recipeVersion}
              </Badge>
            ) : null}
            <RefreshStateBadge state={refreshState} />
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {lastRefreshAt || nextAllowedAt ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {lastRefreshAt
                ? `Last refreshed ${formatDateTime(lastRefreshAt)}.`
                : ""}
              {nextAllowedAt
                ? ` Next allowed ${formatDateTime(nextAllowedAt)}.`
                : ""}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!disabled && onRefresh ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={refreshDisabled}
              onClick={onRefresh}
            >
              <RefreshCcw
                className={isActive ? "size-4 animate-spin" : "size-4"}
              />
              {isActive ? "Refreshing" : "Refresh"}
            </Button>
          ) : null}
          {onAskComputer ? (
            <Button
              type="button"
              size="sm"
              className="gap-2"
              onClick={onAskComputer}
            >
              <Brain className="size-4" />
              Ask Computer
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      ) : null}
      {sourceStatuses ? (
        <SourceStatusList
          title="Refresh source status"
          description="Each source reports whether the deterministic refresh had full, partial, or failed coverage."
          sources={sourceStatusItems(sourceStatuses)}
        />
      ) : null}
      <RefreshStateTimeline state={refreshState} />
    </section>
  );
}

function sourceStatusItems(
  sourceStatuses: Record<string, SourceStatus>,
): SourceStatusItem[] {
  return Object.entries(sourceStatuses).map(([id, status]) => ({
    id,
    label: id,
    status,
  }));
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
