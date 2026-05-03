import { useMemo } from "react";
import {
  normalizeRoutineExecutionManifest,
  type NormalizedRoutineStep,
} from "./routineExecutionManifest";
import { RoutineFlowCanvas } from "./RoutineFlowCanvas";

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
  recipeId?: string;
  recipeType?: string;
  label?: string;
  args?: unknown;
  /** Latest event for this node (may be undefined when no event has
   * landed yet — the row renders as `pending`). */
  latestEvent?: StepEventLite;
}

export interface ExecutionGraphProps {
  /** ASL from `routine_asl_versions.asl_json`; preferred topology source. */
  aslJson?: unknown;
  /** Step manifest from `routine_asl_versions.step_manifest_json`. The
   * value may be a legacy node map, a recipe-graph manifest, or an
   * AWSJSON string. */
  stepManifest: unknown;
  stepEvents: StepEventLite[];
  /** Overall routine execution status. Used only to infer completed
   * output-backed steps when no explicit step callback event exists. */
  executionStatus?: string | null;
  /** Parsed Step Functions output. Some Lambda-backed recipes return
   * useful per-step output but do not currently emit routine_step_events. */
  executionOutput?: unknown;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  className?: string;
}

export interface DeriveNodesOptions {
  executionStatus?: string | null;
  executionOutput?: unknown;
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
  stepManifest: unknown,
  events: StepEventLite[],
  options: DeriveNodesOptions = {},
): StepNode[] {
  const latest = latestEventByNode(events);
  const manifestSteps = normalizeRoutineExecutionManifest(stepManifest);
  if (manifestSteps.length > 0) {
    return manifestSteps.map((step) =>
      nodeFromManifestStep(step, latest, options),
    );
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

function nodeFromManifestStep(
  step: NormalizedRoutineStep,
  latest: Record<string, StepEventLite>,
  options: DeriveNodesOptions,
): StepNode {
  const latestEvent =
    latest[step.nodeId] ?? inferredSucceededEvent(step, options);
  return {
    nodeId: step.nodeId,
    recipeId: step.recipeId,
    recipeType: step.recipeType ?? latestEvent?.recipeType,
    label: step.label,
    args: step.args,
    latestEvent,
  };
}

function inferredSucceededEvent(
  step: NormalizedRoutineStep,
  options: DeriveNodesOptions,
): StepEventLite | undefined {
  if (options.executionStatus !== "succeeded") return undefined;
  if (!outputHasNodeResult(options.executionOutput, step.nodeId)) {
    return undefined;
  }
  return {
    id: `inferred:${step.nodeId}`,
    nodeId: step.nodeId,
    recipeType: step.recipeType ?? step.recipeId ?? "unknown",
    status: "succeeded",
    startedAt: null,
    finishedAt: null,
    retryCount: 0,
  };
}

function outputHasNodeResult(output: unknown, nodeId: string): boolean {
  return (
    output != null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    Object.prototype.hasOwnProperty.call(output, nodeId)
  );
}

export function ExecutionGraph({
  aslJson,
  stepManifest,
  stepEvents,
  executionStatus,
  executionOutput,
  selectedNodeId,
  onSelectNode,
  className,
}: ExecutionGraphProps) {
  const nodes = useMemo(
    () =>
      deriveNodes(stepManifest, stepEvents, {
        executionStatus,
        executionOutput,
      }),
    [stepManifest, stepEvents, executionStatus, executionOutput],
  );

  return (
    <RoutineFlowCanvas
      mode="execution"
      aslJson={aslJson ?? linearAslFromNodes(nodes)}
      stepManifestJson={stepManifest}
      stepEvents={stepEvents}
      executionStatus={executionStatus}
      executionOutput={executionOutput}
      selectedNodeId={selectedNodeId}
      onSelectNode={(nodeId) => nodeId && onSelectNode?.(nodeId)}
      className={className}
      emptyLabel="No steps yet — the execution may still be starting."
    />
  );
}

function linearAslFromNodes(nodes: StepNode[]): Record<string, unknown> {
  return {
    StartAt: nodes[0]?.nodeId,
    States: Object.fromEntries(
      nodes.map((node, index) => {
        const next = nodes[index + 1]?.nodeId;
        return [
          node.nodeId,
          {
            Type: "Task",
            Comment: node.recipeId
              ? `recipe:${node.recipeId}`
              : node.recipeType
                ? `recipe:${node.recipeType}`
                : undefined,
            ...(next ? { Next: next } : { End: true }),
          },
        ];
      }),
    ),
  };
}
