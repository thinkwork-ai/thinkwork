import type {
  RoutineAslGraph,
  RoutineGraphEdge,
  RoutineGraphNode,
} from "@/components/routines/routineAslGraph";
import type { AgentLoopDraft } from "./agent-loop-types";
import type {
  AgentLoopRow,
  AgentLoopSpaceOption,
  AgentLoopWorkerOption,
} from "./agent-loop-types";
import {
  parseDeliveryRecipients,
  scheduleValueLabel,
  draftFromVersion,
} from "./agent-loop-utils";

/**
 * THINK-247: render an automation as the same node/edge graph the Workflows
 * Definition canvas draws — one visual language for both surfaces. The graph
 * is built from the *editable draft* (not the persisted converged workflow),
 * so canvas nodes update live as the inspectors change fields, and a save
 * through `saveAgentLoop` reconverges the real workflow server-side.
 *
 * Node ids are stable and double as inspector routes:
 *   trigger → automation settings (name, trigger, schedule, run-as, space)
 *   work    → the work step (instructions/worker/thread, or routine/workflow)
 *   document→ maintained-document binding (agent_thread only, always shown)
 *   deliver → email delivery (agent_thread only, always shown)
 *
 * `document`/`deliver` render even when unconfigured — an "Off" node is the
 * discoverable way to turn the capability on from the canvas.
 */

export const AUTOMATION_NODE_IDS = {
  trigger: "trigger",
  work: "work",
  document: "document",
  deliver: "deliver",
} as const;

export type AutomationNodeId =
  (typeof AUTOMATION_NODE_IDS)[keyof typeof AUTOMATION_NODE_IDS];

const NODE_WIDTH = 230;
const NODE_HEIGHT = 86;
const ROW_GAP = 56;

export interface BuildAutomationFlowGraphInput {
  draft: AgentLoopDraft;
  /** Display name of the selected routine/workflow target, when applicable. */
  targetLabel?: string | null;
  /** Title of the bound document once known (existing pick or captured). */
  boundDocumentTitle?: string | null;
}

export function buildAutomationFlowGraphFromLoop(input: {
  loop: AgentLoopRow;
  workerOptions?: AgentLoopWorkerOption[];
  spaceOptions?: AgentLoopSpaceOption[];
  defaultSpaceId?: string | null;
  currentUserId?: string | null;
}): RoutineAslGraph {
  const draft = draftFromVersion(
    input.loop,
    input.workerOptions ?? [],
    input.spaceOptions ?? [],
    input.defaultSpaceId,
    input.currentUserId ?? "",
  );
  return buildAutomationFlowGraph({ draft });
}

export function buildAutomationFlowGraph(
  input: BuildAutomationFlowGraphInput,
): RoutineAslGraph {
  const { draft } = input;
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

  pushNode({
    id: AUTOMATION_NODE_IDS.trigger,
    stateName: AUTOMATION_NODE_IDS.trigger,
    label: triggerLabel(draft),
    subtitle: triggerSubtitle(draft),
    kind: "trigger",
  });

  if (draft.targetKind === "agent_thread") {
    pushNode({
      id: AUTOMATION_NODE_IDS.work,
      stateName: AUTOMATION_NODE_IDS.work,
      label: "Agent work",
      subtitle: draft.instructions.trim()
        ? truncate(draft.instructions.trim(), 72)
        : "No instructions yet",
      kind: "agent",
    });
    pushNode({
      id: AUTOMATION_NODE_IDS.document,
      stateName: AUTOMATION_NODE_IDS.document,
      label: "Maintains document",
      subtitle: documentSubtitle(input),
      kind: "document",
    });
    pushNode({
      id: AUTOMATION_NODE_IDS.deliver,
      stateName: AUTOMATION_NODE_IDS.deliver,
      label: "Email delivery",
      subtitle: deliverySubtitle(draft),
      kind: "deliver",
    });
  } else {
    pushNode({
      id: AUTOMATION_NODE_IDS.work,
      stateName: AUTOMATION_NODE_IDS.work,
      label: draft.targetKind === "routine" ? "Run routine" : "Run workflow",
      subtitle: input.targetLabel ?? "Choose a target",
      kind: "routine",
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

  return { nodes, edges, startNodeId: AUTOMATION_NODE_IDS.trigger };
}

function triggerLabel(draft: AgentLoopDraft): string {
  if (draft.triggerFamily === "webhook") return "Webhook trigger";
  if (draft.triggerFamily === "manual") return "Manual trigger";
  return "Schedule";
}

function triggerSubtitle(draft: AgentLoopDraft): string | undefined {
  if (draft.triggerFamily === "webhook") return "Fires on inbound webhook";
  const label = scheduleValueLabel(draft);
  if (label === "Manual") return "Run on demand";
  if (label === "Custom") return draft.scheduleExpression.trim() || undefined;
  return draft.timezone && draft.timezone !== "UTC"
    ? `${label} · ${draft.timezone}`
    : label;
}

function documentSubtitle(
  input: BuildAutomationFlowGraphInput,
): string | undefined {
  const { draft } = input;
  if (draft.bindingMode === "off") return "Off — click to configure";
  if (draft.bindingMode === "create") {
    const title = draft.bindingTitle.trim();
    return title ? `${title} · created on first run` : "Created on first run";
  }
  return (
    input.boundDocumentTitle ??
    (draft.bindingArtifactId.trim() ? "Existing document" : "Choose a document")
  );
}

function deliverySubtitle(draft: AgentLoopDraft): string | undefined {
  if (draft.bindingMode === "off") return "Needs a maintained document";
  if (!draft.deliveryEnabled) return "Off — click to configure";
  const recipients = parseDeliveryRecipients(draft.deliveryRecipients);
  if (recipients.length === 0) return "Add recipients";
  if (recipients.length === 1) return recipients[0];
  return `${recipients[0]} +${recipients.length - 1} more`;
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
