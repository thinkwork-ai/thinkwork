import { RefreshCw } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { FreshnessBadge } from "./FreshnessBadge";
import { ProvenancePopover } from "./ProvenancePopover";
import {
  refreshControlState,
  type CanvasBinding,
  type FreshnessDisplayState,
} from "./binding-display";

export interface BoundWidgetChromeProps {
  bindings: CanvasBinding[];
  currentUserId: string | null;
  /** Binding ids with an in-flight refresh — drives REFRESHING + disable (R8). */
  refreshingBindingIds: ReadonlySet<string>;
  onRefresh: (binding: CanvasBinding) => void;
}

/**
 * Bound-widget chrome (R5/R8/R9): one row per binding with a freshness badge,
 * a provenance popover, and a refresh control whose enablement + copy follows
 * the binding's auth context and the current viewer (owner vs non-owner).
 * Rendered as a strip alongside the canvas rather than injected per-element —
 * the json-render Renderer owns element layout; this reports their data health.
 */
export function BoundWidgetChrome({
  bindings,
  currentUserId,
  refreshingBindingIds,
  onRefresh,
}: BoundWidgetChromeProps) {
  if (bindings.length === 0) return null;
  return (
    <div
      className="grid gap-2 rounded-md border border-border/70 bg-muted/20 p-3"
      data-testid="bound-widget-chrome"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Data sources
      </p>
      <ul className="grid gap-1.5">
        {bindings.map((binding) => (
          <BoundWidgetRow
            key={binding.id}
            binding={binding}
            currentUserId={currentUserId}
            refreshing={refreshingBindingIds.has(binding.id)}
            onRefresh={onRefresh}
          />
        ))}
      </ul>
    </div>
  );
}

function BoundWidgetRow({
  binding,
  currentUserId,
  refreshing,
  onRefresh,
}: {
  binding: CanvasBinding;
  currentUserId: string | null;
  refreshing: boolean;
  onRefresh: (binding: CanvasBinding) => void;
}) {
  const control = refreshControlState({ binding, currentUserId, refreshing });
  const displayState: FreshnessDisplayState = refreshing
    ? "REFRESHING"
    : binding.quality;

  return (
    <li
      className="flex flex-wrap items-center gap-2"
      data-testid="bound-widget-row"
      data-binding-id={binding.id}
    >
      <FreshnessBadge state={displayState} />
      <span className="min-w-0 truncate text-sm">{binding.elementId}</span>
      <span className="text-xs text-muted-foreground">
        via {binding.serverName}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <ProvenancePopover binding={binding} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={!control.enabled}
          title={control.hint}
          onClick={() => onRefresh(binding)}
          data-testid="binding-refresh-button"
          data-needs-owner={control.needsOwnerAction ? "true" : "false"}
        >
          <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
          {control.label}
        </Button>
      </div>
    </li>
  );
}
