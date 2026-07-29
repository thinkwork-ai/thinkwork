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
const COLUMN_GAP = 28;

export const MEMORY_TRIGGER_NODE_ID = "memory-trigger";
export const MEMORY_SOURCE_NODE_PREFIX = "memory-source-";

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

export interface MemoryPipelineSourceNode {
  nodeId: string;
  family: string;
  label: string;
  description: string;
  optional: boolean;
  configured: boolean;
  enabled: boolean;
}

const OPTIONAL_SOURCE_CATALOG = [
  {
    family: "twenty",
    label: "Twenty CRM",
    description:
      "Customer records from Twenty CRM enrich memory when the workspace source is configured and enabled.",
  },
  {
    family: "email",
    label: "Gmail",
    description:
      "Approved Gmail labels enrich personal memory when the user has opted in and the connection is active.",
  },
  {
    family: "firecrawl",
    label: "Web pages",
    description:
      "Authorized web pages enrich memory when a bounded Firecrawl source is configured.",
  },
] as const;

/**
 * Product-level source nodes. Threads are the always-on baseline: completed
 * turns are retained into Hindsight independently of external acquisition.
 * Database source configs represent optional enrichments and therefore render
 * as skipped/off instead of making the whole workflow not-ready.
 */
export function memoryPipelineSourceNodes(
  pipeline: MemoryPipelineView,
): MemoryPipelineSourceNode[] {
  const threads: MemoryPipelineSourceNode = {
    nodeId: `${MEMORY_SOURCE_NODE_PREFIX}threads`,
    family: "threads",
    label: "Threads",
    description:
      "Thread conversations are retained into Hindsight after each completed turn and compounded into this memory bank.",
    optional: false,
    configured: true,
    enabled: true,
  };
  const optional = OPTIONAL_SOURCE_CATALOG.map((catalog) => {
    const configs = pipeline.sources.filter(
      (source) => source.sourceFamily === catalog.family,
    );
    return {
      nodeId: `${MEMORY_SOURCE_NODE_PREFIX}${catalog.family}`,
      ...catalog,
      optional: true,
      configured: configs.length > 0,
      enabled: configs.some((source) => source.enabled),
    };
  });
  return [threads, ...optional];
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
  const pushNode = (
    node: Omit<RoutineGraphNode, "position" | "width" | "height">,
    position: { x: number; y: number },
  ) => {
    nodes.push({
      ...node,
      position,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  };

  pushNode(
    {
      id: MEMORY_TRIGGER_NODE_ID,
      stateName: MEMORY_TRIGGER_NODE_ID,
      label: input.triggerFamily === "schedule" ? "Schedule" : "Manual trigger",
      subtitle:
        input.triggerFamily === "schedule"
          ? (input.scheduleLabel ?? "On a schedule")
          : "Run on demand",
      kind: "trigger",
    },
    { x: 0, y: 0 },
  );

  const sourceNodes = memoryPipelineSourceNodes(input.pipeline);
  const sourceY = NODE_HEIGHT + ROW_GAP;
  const sourceSpan =
    sourceNodes.length * NODE_WIDTH + (sourceNodes.length - 1) * COLUMN_GAP;
  const sourceStartX = -(sourceSpan - NODE_WIDTH) / 2;
  sourceNodes.forEach((source, index) => {
    pushNode(
      {
        id: source.nodeId,
        stateName: source.nodeId,
        label: source.label,
        subtitle: source.optional
          ? source.enabled
            ? "Configured"
            : source.configured
              ? "Disabled · skipped"
              : "Not configured · skipped"
          : "Always on · Hindsight",
        kind: "memory_source",
        status: source.enabled ? undefined : "skipped",
      },
      { x: sourceStartX + index * (NODE_WIDTH + COLUMN_GAP), y: sourceY },
    );
    edges.push({
      id: `${MEMORY_TRIGGER_NODE_ID}->${source.nodeId}`,
      source: MEMORY_TRIGGER_NODE_ID,
      target: source.nodeId,
      kind: "start",
    });
  });

  let stageY = sourceY + NODE_HEIGHT + ROW_GAP;

  for (const stage of input.pipeline.stages) {
    pushNode(
      {
        id: stage.id,
        stateName: stage.id,
        label: stage.label,
        subtitle: subtitleForStage(stage),
        kind: stage.stage === "plan-review" ? "approval" : "memory_stage",
        status: statusForStage(stage),
      },
      { x: 0, y: stageY },
    );
    stageY += NODE_HEIGHT + ROW_GAP;
  }

  const firstStage = input.pipeline.stages[0];
  if (firstStage) {
    for (const source of sourceNodes) {
      edges.push({
        id: `${source.nodeId}->${firstStage.id}`,
        source: source.nodeId,
        target: firstStage.id,
        kind: "next",
      });
    }
  }
  for (let i = 0; i < input.pipeline.stages.length - 1; i += 1) {
    const source = input.pipeline.stages[i]!;
    const target = input.pipeline.stages[i + 1]!;
    edges.push({
      id: `${source.id}->${target.id}`,
      source: source.id,
      target: target.id,
      kind: "next",
    });
  }

  return { nodes, edges, startNodeId: MEMORY_TRIGGER_NODE_ID };
}
