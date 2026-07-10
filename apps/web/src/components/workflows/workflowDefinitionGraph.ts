import type {
  RoutineAslGraph,
  RoutineGraphEdge,
  RoutineGraphNode,
} from "@/components/routines/routineAslGraph";

/**
 * Convert a ThinkWork workflow definition (the typed-steps document from
 * packages/agent-loops-core/src/workflow-definition.ts) into the same graph
 * shape the routine ASL canvas renders, so the Workflows Definition tab gets
 * the visual canvas back without interpreting Step Functions ASL. The
 * definition is a linear chain — start → steps in order → end — plus a
 * loop-back edge when a continuationPolicy is present.
 */

const NODE_WIDTH = 230;
const NODE_HEIGHT = 86;
const COMPACT_WIDTH = 150;
const COMPACT_HEIGHT = 54;
const ROW_GAP = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stepSubtitle(step: Record<string, unknown>): string | undefined {
  switch (stringField(step, "kind")) {
    case "agent":
      return stringField(step, "objective") ?? undefined;
    case "routine":
      return stringField(step, "routineId") ?? undefined;
    case "tool":
      return stringField(step, "tool") ?? undefined;
    case "approval":
      return stringField(step, "prompt") ?? undefined;
    case "wait": {
      const until = stringField(step, "until");
      if (until) return `Until ${until}`;
      const duration = numberField(step, "durationSeconds");
      return duration != null ? `${duration}s` : undefined;
    }
    case "http": {
      const url = stringField(step, "url");
      if (!url) return undefined;
      return `${stringField(step, "method") ?? "GET"} ${url}`;
    }
    case "emit_event":
      return stringField(step, "eventType") ?? undefined;
    case "deliver": {
      const recipients = Array.isArray(step.recipients)
        ? step.recipients.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
      if (recipients.length === 0) return undefined;
      return recipients.length === 1
        ? recipients[0]
        : `${recipients[0]} +${recipients.length - 1} more`;
    }
    default:
      return undefined;
  }
}

export function buildWorkflowDefinitionGraph(
  definition: unknown,
): RoutineAslGraph {
  if (!isRecord(definition) || !Array.isArray(definition.steps)) {
    return {
      nodes: [],
      edges: [],
      error: "No structured step definition is available.",
    };
  }
  const steps = definition.steps.filter(isRecord);
  if (steps.length === 0) {
    return {
      nodes: [],
      edges: [],
      error: "This workflow definition has no steps yet.",
    };
  }

  const nodes: RoutineGraphNode[] = [];
  const edges: RoutineGraphEdge[] = [];
  const centerX = 0;
  let y = 0;

  const pushNode = (node: Omit<RoutineGraphNode, "position">) => {
    nodes.push({
      ...node,
      position: { x: centerX + (NODE_WIDTH - node.width) / 2, y },
    });
    y += node.height + ROW_GAP;
  };

  pushNode({
    id: "__start",
    stateName: "__start",
    label: "Start",
    kind: "start",
    width: COMPACT_WIDTH,
    height: COMPACT_HEIGHT,
  });

  const stepIds = steps.map(
    (step, index) => stringField(step, "id") ?? `step-${index + 1}`,
  );
  steps.forEach((step, index) => {
    pushNode({
      id: stepIds[index],
      stateName: stepIds[index],
      label: stepIds[index],
      subtitle: stepSubtitle(step),
      kind: stringField(step, "kind") ?? "task",
      args: step,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  pushNode({
    id: "__end",
    stateName: "__end",
    label: "Done",
    kind: "succeed",
    width: COMPACT_WIDTH,
    height: COMPACT_HEIGHT,
  });

  edges.push({
    id: "__start->first",
    source: "__start",
    target: stepIds[0],
    kind: "start",
  });
  for (let i = 0; i < stepIds.length - 1; i += 1) {
    edges.push({
      id: `${stepIds[i]}->${stepIds[i + 1]}`,
      source: stepIds[i],
      target: stepIds[i + 1],
      kind: "next",
    });
  }

  const policy = isRecord(definition.continuationPolicy)
    ? definition.continuationPolicy
    : null;
  const lastStepId = stepIds[stepIds.length - 1];
  if (policy) {
    const maxIterations = numberField(policy, "maxIterations");
    edges.push({
      id: "__loop",
      source: lastStepId,
      target: stepIds[0],
      kind: "choice",
      label: maxIterations ? `loop · max ${maxIterations}` : "loop until done",
    });
    edges.push({
      id: "__exit",
      source: lastStepId,
      target: "__end",
      kind: "default",
      label: stringField(policy, "exitSignal") ?? "done",
    });
  } else {
    edges.push({
      id: `${lastStepId}->__end`,
      source: lastStepId,
      target: "__end",
      kind: "end",
    });
  }

  return { nodes, edges, startNodeId: stepIds[0] };
}
