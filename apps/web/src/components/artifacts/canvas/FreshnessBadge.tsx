import { Loader2 } from "lucide-react";
import { Badge, cn } from "@thinkwork/ui";
import {
  freshnessBadgeConfig,
  type FreshnessDisplayState,
} from "./binding-display";

const TONE_CLASSES: Record<
  ReturnType<typeof freshnessBadgeConfig>["tone"],
  string
> = {
  // GOOD is deliberately subtle — a quiet muted chip, not a loud green.
  good: "border-transparent bg-muted text-muted-foreground",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  // schema-stale is distinct from a transient failure (violet, not red).
  schema:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  refreshing: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

export function FreshnessBadge({
  state,
  className,
}: {
  state: FreshnessDisplayState;
  className?: string;
}) {
  const config = freshnessBadgeConfig(state);
  return (
    <Badge
      variant="outline"
      className={cn(TONE_CLASSES[config.tone], className)}
      title={config.description}
      aria-label={`Data freshness: ${config.label}. ${config.description}`}
      data-testid="freshness-badge"
      data-state={state}
    >
      {state === "REFRESHING" ? (
        <Loader2
          className="size-3 animate-spin"
          data-testid="freshness-badge-spinner"
        />
      ) : null}
      {config.label}
    </Badge>
  );
}
