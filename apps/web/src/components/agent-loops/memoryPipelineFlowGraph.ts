/**
 * Definition graph for the built-in memory Automation (THINK-264).
 *
 * The other Automations project a fixed trigger → work → document → deliver
 * shape out of their specs. The memory Automation is different: its steps ARE
 * the pipeline, and the server hands us the exact stage list built from the
 * same blueprint the interpreter executes. So this builder is a straight
 * rendering of `AgentLoop.memoryPipeline.stages` — no client-side idea of what
 * the pipeline contains, which is what keeps the picture honest.
 *
 * A disabled stage is drawn as a present-but-off node rather than dropped, so
 * the graph shows the whole pipeline and which parts of it are switched off.
 */

import type {
  RoutineAslGraph,
  RoutineGraphEdge,
  RoutineGraphNode,
} from "../routines/routineAslGraph";

const NODE_WIDTH = 210;
const NODE_HEIGHT = 86;
const ROW_GAP = 34;

export const MEMORY_TRIGGER_NODE_ID = "memory-trigger";

export interface MemoryPipelineStageView {
  id: string;
  stage: string;
  label: string;
  description: string;
  enabled: boolean;
  toggleable: boolean;
  lastResult?: string | null;
}

export interface MemoryPipelineView {
  processorConfigId: string;
  mode: string;
  workflowId?: string | null;
  enabled: boolean;
  readiness: string;
  /** AWSJSON — arrives as a JSON string; read via readMemoryReadinessReasons. */
  readinessReasons?: unknown;
  scheduleExpression?: string | null;
  scheduleTimezone?: string | null;
  scheduleEnabled?: boolean;
  sources: {
    id: string;
    sourceFamily: string;
    enabled: boolean;
  }[];
  stages: MemoryPipelineStageView[];
}

export interface MemoryReadinessReason {
  code: string;
  message: string;
}

export function readMemoryReadinessReasons(
  pipeline: MemoryPipelineView,
): MemoryReadinessReason[] {
  const raw = pipeline.readinessReasons;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = [];
    }
  }
  return Array.isArray(parsed) ? (parsed as MemoryReadinessReason[]) : [];
}

export interface BuildMemoryPipelineGraphInput {
  pipeline: MemoryPipelineView;
  triggerFamily: string;
  scheduleLabel?: string | null;
}

/** Map a stage's last run-item result onto the canvas' status vocabulary. */
function statusForStage(stage: MemoryPipelineStageView): string | undefined {
  if (!stage.enabled) return "skipped";
  switch (stage.lastResult) {
    case "failed":
      return "failed";
    case "deferred":
      return "waiting";
    case "changed":
    case "seen":
    case "retracted":
      return "succeeded";
    case "noop":
      return "skipped";
    default:
      return undefined;
  }
}

function subtitleForStage(stage: MemoryPipelineStageView): string {
  if (!stage.enabled) return "Turned off";
  return stage.description;
}

export function buildMemoryPipelineFlowGraph(
  input: BuildMemoryPipelineGraphInput,
): RoutineAslGraph {
  const nodes: RoutineGraphNode[] = [];
  const edges: RoutineGraphEdge[] = [];
  let y = 0;

  const pushNode = (
    node: Omit<RoutineGraphNode, "position" | "width" | "height">,
  ) => {
    nodes.push({
      ...node,
      position: { x: 0, y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
    y += NODE_HEIGHT + ROW_GAP;
  };

  const enabledSources = input.pipeline.sources.filter((s) => s.enabled);
  pushNode({
    id: MEMORY_TRIGGER_NODE_ID,
    stateName: MEMORY_TRIGGER_NODE_ID,
    label: input.triggerFamily === "schedule" ? "Schedule" : "Manual trigger",
    subtitle:
      input.triggerFamily === "schedule"
        ? (input.scheduleLabel ?? "On a schedule")
        : "Run on demand",
    kind: "trigger",
  });

  for (const stage of input.pipeline.stages) {
    pushNode({
      id: stage.id,
      stateName: stage.id,
      label: stage.label,
      subtitle:
        stage.stage === "acquire" && enabledSources.length > 0
          ? `${enabledSources.map((s) => s.sourceFamily).join(", ")}`
          : subtitleForStage(stage),
      kind: stage.stage === "plan-review" ? "approval" : "memory_stage",
      status: statusForStage(stage),
    });
  }

  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({
      id: `${nodes[i].id}->${nodes[i + 1].id}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      kind: i === 0 ? "start" : "next",
    });
  }

  return { nodes, edges, startNodeId: MEMORY_TRIGGER_NODE_ID };
}
