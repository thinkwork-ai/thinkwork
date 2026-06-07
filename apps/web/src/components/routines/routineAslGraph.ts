import { Graph, layout } from "@dagrejs/dagre";
import type { StepEventLite } from "./ExecutionGraph";
import { normalizeRoutineExecutionManifest } from "./routineExecutionManifest";

export type RoutineGraphMode = "authoring" | "execution";

export interface RoutineGraphNode {
  id: string;
  stateName: string;
  label: string;
  subtitle?: string;
  kind: string;
  recipeId?: string;
  status?: string;
  args?: unknown;
  groupId?: string;
  parentId?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface RoutineGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind: "next" | "choice" | "default" | "catch" | "start" | "end";
}

export interface RoutineAslGraph {
  nodes: RoutineGraphNode[];
  edges: RoutineGraphEdge[];
  startNodeId?: string;
  error?: string;
}

export interface BuildRoutineAslGraphInput {
  aslJson: unknown;
  stepManifestJson?: unknown;
  stepEvents?: StepEventLite[];
  executionStatus?: string | null;
  executionOutput?: unknown;
}

type AslObject = Record<string, unknown>;

const NODE_WIDTH = 210;
const NODE_HEIGHT = 86;
const GROUP_WIDTH = 260;
const GROUP_HEIGHT = 120;

export function buildRoutineAslGraph(
  input: BuildRoutineAslGraphInput,
): RoutineAslGraph {
  const asl = normalizeObject(input.aslJson);
  const states = normalizeObject(asl.States);
  const startAt = stringValue(asl.StartAt);

  if (!startAt || Object.keys(states).length === 0) {
    return {
      nodes: [],
      edges: [],
      error: "Routine ASL is missing StartAt or States.",
    };
  }

  const manifest = manifestByNode(input.stepManifestJson);
  const latest = latestEventByNode(input.stepEvents ?? []);
  const nodes: RoutineGraphNode[] = [
    graphNode({
      id: "__start",
      stateName: "__start",
      label: "Start",
      kind: "start",
      width: 160,
      height: 76,
    }),
  ];
  const edges: RoutineGraphEdge[] = [
    {
      id: "__start->" + startAt,
      source: "__start",
      target: startAt,
      kind: "start",
    },
  ];
  const terminalTargets = new Set<string>();

  for (const [stateName, rawState] of Object.entries(states)) {
    const state = normalizeObject(rawState);
    const manifestStep = manifest.get(stateName);
    const status =
      latest[stateName]?.status ??
      inferredStatus(stateName, manifestStep?.recipeType, input);
    const kind = stateKind(state);
    nodes.push(
      graphNode({
        id: stateName,
        stateName,
        label: manifestStep?.label ?? titleFromStateName(stateName),
        subtitle: subtitleForState(state, manifestStep?.recipeType),
        kind,
        recipeId: manifestStep?.recipeType,
        status,
        args: manifestStep?.args,
      }),
    );

    if (kind === "map") {
      appendNestedStateMachine({
        parentStateName: stateName,
        parentKind: "map",
        machine:
          normalizeNestedMachine(state.ItemProcessor) ??
          normalizeNestedMachine(state.Iterator),
        nodes,
        edges,
      });
    }

    if (kind === "parallel" && Array.isArray(state.Branches)) {
      state.Branches.forEach((branch, index) =>
        appendNestedStateMachine({
          parentStateName: stateName,
          parentKind: "parallel",
          branchIndex: index + 1,
          machine: normalizeNestedMachine(branch),
          nodes,
          edges,
        }),
      );
    }

    appendStateEdges(stateName, state, edges, terminalTargets);
  }

  for (const stateName of terminalTargets) {
    const endId = `${stateName}.__end`;
    nodes.push(
      graphNode({
        id: endId,
        stateName: endId,
        label: "End",
        kind: "end",
        width: 160,
        height: 76,
      }),
    );
    edges.push({
      id: `${stateName}->${endId}`,
      source: stateName,
      target: endId,
      kind: "end",
    });
  }

  return {
    nodes: layoutNodes(nodes, edges),
    edges,
    startNodeId: startAt,
  };
}

function appendStateEdges(
  stateName: string,
  state: AslObject,
  edges: RoutineGraphEdge[],
  terminalTargets: Set<string>,
) {
  const choices = Array.isArray(state.Choices) ? state.Choices : [];
  if (choices.length > 0) {
    choices.forEach((choice, index) => {
      const choiceObject = normalizeObject(choice);
      const target = stringValue(choiceObject.Next);
      if (!target) return;
      edges.push({
        id: `${stateName}->choice:${index}->${target}`,
        source: stateName,
        target,
        label: choiceLabel(choiceObject),
        kind: "choice",
      });
    });
    const defaultTarget = stringValue(state.Default);
    if (defaultTarget) {
      edges.push({
        id: `${stateName}->default->${defaultTarget}`,
        source: stateName,
        target: defaultTarget,
        label: "Default",
        kind: "default",
      });
    }
  }

  const next = stringValue(state.Next);
  if (next) {
    edges.push({
      id: `${stateName}->${next}`,
      source: stateName,
      target: next,
      kind: "next",
    });
  }

  if (Array.isArray(state.Catch)) {
    state.Catch.forEach((catcher, index) => {
      const catchObject = normalizeObject(catcher);
      const target = stringValue(catchObject.Next);
      if (!target) return;
      const errors = Array.isArray(catchObject.ErrorEquals)
        ? catchObject.ErrorEquals.map(String).join(", ")
        : "Error";
      edges.push({
        id: `${stateName}->catch:${index}->${target}`,
        source: stateName,
        target,
        label: errors,
        kind: "catch",
      });
    });
  }

  if (state.End === true || state.Type === "Succeed" || state.Type === "Fail") {
    terminalTargets.add(stateName);
  }
}

function appendNestedStateMachine(input: {
  parentStateName: string;
  parentKind: "map" | "parallel";
  branchIndex?: number;
  machine: AslObject | null;
  nodes: RoutineGraphNode[];
  edges: RoutineGraphEdge[];
}) {
  if (!input.machine) return;
  const states = normalizeObject(input.machine.States);
  const startAt = stringValue(input.machine.StartAt);
  if (!startAt || Object.keys(states).length === 0) return;

  const groupId = [
    input.parentStateName,
    input.parentKind,
    input.branchIndex ?? "items",
  ].join(".");
  input.nodes.push(
    graphNode({
      id: groupId,
      stateName: groupId,
      label:
        input.parentKind === "map"
          ? "Map iterator"
          : `Parallel branch ${input.branchIndex}`,
      kind: "group",
      parentId: input.parentStateName,
      width: GROUP_WIDTH,
      height: GROUP_HEIGHT,
    }),
  );

  for (const [stateName, rawState] of Object.entries(states)) {
    const state = normalizeObject(rawState);
    const childId = `${groupId}.${stateName}`;
    input.nodes.push(
      graphNode({
        id: childId,
        stateName,
        label: titleFromStateName(stateName),
        subtitle: state.Type ? String(state.Type) : undefined,
        kind: stateKind(state),
        groupId,
        parentId: groupId,
        width: 180,
        height: 74,
      }),
    );
    const next = stringValue(state.Next);
    if (next) {
      input.edges.push({
        id: `${childId}->${groupId}.${next}`,
        source: childId,
        target: `${groupId}.${next}`,
        kind: "next",
      });
    }
  }
}

function graphNode(
  input: Omit<RoutineGraphNode, "position" | "width" | "height"> & {
    width?: number;
    height?: number;
  },
): RoutineGraphNode {
  return {
    ...input,
    width: input.width ?? NODE_WIDTH,
    height: input.height ?? NODE_HEIGHT,
    position: { x: 0, y: 0 },
  };
}

function layoutNodes(
  nodes: RoutineGraphNode[],
  edges: RoutineGraphEdge[],
): RoutineGraphNode[] {
  const graph = new Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", nodesep: 52, ranksep: 94 });
  for (const node of nodes) {
    graph.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  layout(graph);

  const positioned = nodes.map((node) => {
    const laidOut = graph.node(node.id);
    if (!laidOut) return node;
    return {
      ...node,
      position: {
        x: laidOut.x - node.width / 2,
        y: laidOut.y - node.height / 2,
      },
    };
  });

  return alignStraightRuns(positioned, edges);
}

function alignStraightRuns(
  nodes: RoutineGraphNode[],
  edges: RoutineGraphEdge[],
): RoutineGraphNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
  }

  for (const edge of edges) {
    if (!isStraightRunEdge(edge)) continue;
    if ((outgoing.get(edge.source) ?? 0) !== 1) continue;
    if ((incoming.get(edge.target) ?? 0) !== 1) continue;

    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;

    target.position = {
      ...target.position,
      x: source.position.x + source.width / 2 - target.width / 2,
    };
  }

  return nodes;
}

function isStraightRunEdge(edge: RoutineGraphEdge): boolean {
  return edge.kind === "start" || edge.kind === "next" || edge.kind === "end";
}

function manifestByNode(value: unknown) {
  const steps = normalizeRoutineExecutionManifest(value);
  return new Map(steps.map((step) => [step.nodeId, step]));
}

function latestEventByNode(
  events: StepEventLite[],
): Record<string, StepEventLite> {
  const byNode: Record<string, StepEventLite> = {};
  for (const ev of events) {
    const existing = byNode[ev.nodeId];
    if (!existing) {
      byNode[ev.nodeId] = ev;
      continue;
    }
    const existingFinished = !!existing.finishedAt;
    const candidateFinished = !!ev.finishedAt;
    if (candidateFinished && !existingFinished) {
      byNode[ev.nodeId] = ev;
      continue;
    }
    if (!candidateFinished && existingFinished) continue;
    const existingStart = existing.startedAt ?? "";
    const candidateStart = ev.startedAt ?? "";
    if (candidateStart > existingStart) byNode[ev.nodeId] = ev;
  }
  return byNode;
}

function inferredStatus(
  nodeId: string,
  recipeType: string | undefined,
  input: BuildRoutineAslGraphInput,
): string | undefined {
  if (input.executionStatus !== "succeeded") return undefined;
  if (
    input.executionOutput == null ||
    typeof input.executionOutput !== "object" ||
    Array.isArray(input.executionOutput) ||
    !Object.prototype.hasOwnProperty.call(input.executionOutput, nodeId)
  ) {
    return undefined;
  }
  return recipeType ? "succeeded" : undefined;
}

function stateKind(state: AslObject): string {
  const type = String(state.Type ?? "Task").toLowerCase();
  if (type === "choice") return "choice";
  if (type === "map") return "map";
  if (type === "parallel") return "parallel";
  if (type === "succeed" || type === "fail") return type;
  if (type === "pass") return "pass";
  return "task";
}

function subtitleForState(
  state: AslObject,
  recipeType: string | undefined,
): string | undefined {
  if (recipeType) return recipeType;
  if (state.Type) return String(state.Type);
  return undefined;
}

function choiceLabel(choice: AslObject): string {
  const condition = stringValue(choice.Condition);
  if (condition) return condition;
  const variable = stringValue(choice.Variable);
  for (const [key, value] of Object.entries(choice)) {
    if (key === "Next" || key === "Variable") continue;
    if (key.endsWith("Path")) continue;
    if (["And", "Or", "Not"].includes(key)) return key;
    if (!variable) return `${key} ${String(value)}`;
    return `${variable} ${operatorLabel(key)} ${String(value)}`;
  }
  return "Condition";
}

function operatorLabel(operator: string): string {
  return operator
    .replace(/Equals$/, " =")
    .replace(/GreaterThanEquals$/, " >=")
    .replace(/GreaterThan$/, " >")
    .replace(/LessThanEquals$/, " <=")
    .replace(/LessThan$/, " <")
    .replace(/^StringMatches$/, " matches")
    .replace(/^IsPresent$/, " present");
}

function normalizeNestedMachine(value: unknown): AslObject | null {
  const object = normalizeObject(value);
  if (Object.keys(object).length === 0) return null;
  return object;
}

function normalizeObject(value: unknown): AslObject {
  if (typeof value === "string") {
    try {
      return normalizeObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as AslObject;
  }
  return {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function titleFromStateName(value: string): string {
  return (
    value
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .trim() || value
  );
}
