/**
 * ExecutionGraph — vertical step-list visualization of a routine execution
 * (Plan 2026-05-01-007 §U13).
 *
 * v1 ships as a vertical stepper: each ASL state name from the step
 * manifest renders as a row, and live status from `routine_step_events`
 * paints the dot + label. We intentionally avoid a fancy DAG renderer
 * for v1 — a vertical list is the right shape for run-watching, scales
 * cleanly to mobile parity, and matches the AGENTS-md pattern of "ship
 * the simple thing first".
 *
 * Step-event rows are append-only and may include multiple statuses for
 * the same node (running → succeeded). We collapse to "latest status per
 * node" for graph rendering and keep the full event list available for
 * the StepDetailPanel.
 */

import { useMemo } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  XCircle,
  PauseCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepEventLite {
  id: string;
  nodeId: string;
  recipeType: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  retryCount: number;
}

export interface StepNode {
  /** ASL state name — stable per routine version. */
  nodeId: string;
  /** v0 recipe id, if known from the step manifest. */
  recipeType?: string;
  /** Latest event for this node (may be undefined when no event has
   * landed yet — the row renders as `pending`). */
  latestEvent?: StepEventLite;
}

export interface ExecutionGraphProps {
  /** Step manifest from `routine_asl_versions.step_manifest_json`. The
   * shape is `{ <nodeId>: { recipeType: string, ... } }`; we only read
   * the keys + recipeType for graph layout. */
  stepManifest: Record<string, { recipeType?: string }> | null | undefined;
  stepEvents: StepEventLite[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
}

/** Collapse multi-event-per-node to the latest event by `started_at`
 * (then `created_at` proxy via id descending). Exported for tests. */
export function latestEventByNode(
  events: StepEventLite[],
): Record<string, StepEventLite> {
  const byNode: Record<string, StepEventLite> = {};
  for (const ev of events) {
    const existing = byNode[ev.nodeId];
    if (!existing) {
      byNode[ev.nodeId] = ev;
      continue;
    }
    // Prefer the event with a finishedAt (terminal) over a running event.
    // Otherwise prefer the more recent startedAt.
    const existingFinished = !!existing.finishedAt;
    const candidateFinished = !!ev.finishedAt;
    if (candidateFinished && !existingFinished) {
      byNode[ev.nodeId] = ev;
      continue;
    }
    if (!candidateFinished && existingFinished) {
      continue;
    }
    const existingStart = existing.startedAt ?? "";
    const candidateStart = ev.startedAt ?? "";
    if (candidateStart > existingStart) {
      byNode[ev.nodeId] = ev;
    }
  }
  return byNode;
}

/** Order step manifest keys deterministically. The manifest is a JSON
 * object, so insertion order is the natural sequence the publish flow
 * emitted. We keep it as-is (Object.keys() preserves insertion order
 * in V8). When the manifest is empty, we synthesize from the step
 * events themselves so the graph still renders something. */
export function deriveNodes(
  stepManifest: Record<string, { recipeType?: string }> | null | undefined,
  events: StepEventLite[],
): StepNode[] {
  const latest = latestEventByNode(events);
  if (stepManifest && Object.keys(stepManifest).length > 0) {
    return Object.entries(stepManifest).map(([nodeId, meta]) => ({
      nodeId,
      recipeType: meta?.recipeType ?? latest[nodeId]?.recipeType,
      latestEvent: latest[nodeId],
    }));
  }
  // Fallback: derive from events. Order by earliest startedAt.
  const seen = new Set<string>();
  const sorted = [...events].sort((a, b) => {
    const aStart = a.startedAt ?? "";
    const bStart = b.startedAt ?? "";
    return aStart.localeCompare(bStart);
  });
  const nodes: StepNode[] = [];
  for (const ev of sorted) {
    if (seen.has(ev.nodeId)) continue;
    seen.add(ev.nodeId);
    nodes.push({
      nodeId: ev.nodeId,
      recipeType: ev.recipeType,
      latestEvent: latest[ev.nodeId],
    });
  }
  return nodes;
}

interface StatusPresentation {
  Icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
}

function statusPresentation(status: string | undefined): StatusPresentation {
  switch (status) {
    case "running":
      return {
        Icon: Loader2,
        iconClass: "text-blue-500 animate-spin",
        label: "Running",
      };
    case "succeeded":
      return {
        Icon: CheckCircle2,
        iconClass: "text-green-500",
        label: "Succeeded",
      };
    case "failed":
      return {
        Icon: XCircle,
        iconClass: "text-red-500",
        label: "Failed",
      };
    case "cancelled":
      return {
        Icon: AlertCircle,
        iconClass: "text-zinc-500",
        label: "Cancelled",
      };
    case "timed_out":
      return {
        Icon: Clock,
        iconClass: "text-amber-500",
        label: "Timed out",
      };
    case "awaiting_approval":
      return {
        Icon: PauseCircle,
        iconClass: "text-purple-500",
        label: "Awaiting approval",
      };
    default:
      return {
        Icon: Circle,
        iconClass: "text-zinc-300 dark:text-zinc-600",
        label: "Pending",
      };
  }
}

export function ExecutionGraph({
  stepManifest,
  stepEvents,
  selectedNodeId,
  onSelectNode,
}: ExecutionGraphProps) {
  const nodes = useMemo(
    () => deriveNodes(stepManifest, stepEvents),
    [stepManifest, stepEvents],
  );

  if (nodes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center">
        <Muted>No steps yet — the execution may still be starting.</Muted>
      </div>
    );
  }

  return (
    <ol className="relative space-y-1 border-l border-zinc-200 dark:border-zinc-800 pl-4">
      {nodes.map((node, idx) => {
        const presentation = statusPresentation(node.latestEvent?.status);
        const Icon = presentation.Icon;
        const isSelected = selectedNodeId === node.nodeId;
        const isClickable = !!onSelectNode;
        const interactiveClass = isClickable
          ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
          : "";
        return (
          <li
            key={node.nodeId}
            id={`step-${node.nodeId}`}
            className={cn(
              "relative -ml-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors",
              interactiveClass,
              isSelected && "bg-zinc-50 dark:bg-zinc-900",
            )}
            onClick={() => onSelectNode?.(node.nodeId)}
            role={isClickable ? "button" : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={(e) => {
              if (!isClickable) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectNode?.(node.nodeId);
              }
            }}
          >
            <span
              aria-hidden
              className="absolute -left-[19px] flex h-4 w-4 items-center justify-center rounded-full bg-white dark:bg-zinc-950"
            >
              <Icon className={cn("h-4 w-4", presentation.iconClass)} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 tabular-nums">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="font-medium truncate">{node.nodeId}</span>
                {node.recipeType && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    {node.recipeType}
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {presentation.label}
                {node.latestEvent?.retryCount
                  ? ` · ${node.latestEvent.retryCount} retr${node.latestEvent.retryCount === 1 ? "y" : "ies"}`
                  : ""}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sm text-zinc-500 dark:text-zinc-400">{children}</span>
  );
}
