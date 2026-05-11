import type { RunbookDefinition } from "@thinkwork/runbooks";
import {
  taskQueuePart,
  type TaskQueueData,
} from "../task-queues/message-parts.js";

type RunbookRunForMessage = {
  id: string;
  status: string;
  runbookSlug: string;
  runbookVersion: string;
  tasks: Array<{
    id: string;
    phaseId: string;
    phaseTitle: string;
    taskKey: string;
    title: string;
    status: string;
    dependsOn: unknown;
    sortOrder: number;
  }>;
};

export type RunbookMessagePart = {
  type: "text" | "data-runbook-confirmation" | "data-task-queue";
  id: string;
  text?: string;
  data?: Record<string, unknown>;
};

export function buildRunbookConfirmationMessage(input: {
  run: RunbookRunForMessage;
  runbook: RunbookDefinition;
  sourceMessageId: string;
  confidence: number;
  matchedKeywords?: string[];
}) {
  const data = {
    mode: "approval",
    runbookRunId: input.run.id,
    runbookSlug: input.runbook.slug,
    runbookVersion: input.runbook.version,
    title: input.runbook.approval.title,
    displayName: input.runbook.catalog.displayName,
    description: input.runbook.catalog.description,
    summary: input.runbook.approval.summary,
    expectedOutputs: input.runbook.approval.expectedOutputs,
    likelyTools: input.runbook.approval.likelyTools,
    phaseSummary: input.runbook.approval.phaseSummary,
    phases: input.runbook.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      dependsOn: phase.dependsOn,
    })),
    sourceMessageId: input.sourceMessageId,
    confidence: input.confidence,
    matchedKeywords: input.matchedKeywords ?? [],
  };
  const content = `${input.runbook.catalog.displayName} looks like the right runbook. Please confirm before I start.`;
  return {
    content,
    parts: [
      textPart("runbook-confirmation-intro", content),
      dataPart("runbook-confirmation", input.run.id, data),
    ],
  };
}

export function buildRunbookQueueMessage(input: {
  run: RunbookRunForMessage;
  runbook: RunbookDefinition;
  sourceMessageId: string;
}) {
  const groupedPhases = input.runbook.phases.map((phase) => ({
    id: phase.id,
    title: phase.title,
    tasks: input.run.tasks
      .filter((task) => task.phaseId === phase.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((task) => ({
        id: task.id,
        key: task.taskKey,
        title: task.title,
        status: task.status,
        dependsOn: task.dependsOn,
        sortOrder: task.sortOrder,
      })),
  }));
  const content = `Starting ${input.runbook.catalog.displayName}. I will work through the runbook queue in order.`;
  return {
    content,
    parts: [
      textPart("runbook-queue-intro", content),
      buildRunbookTaskQueuePart({
        run: input.run,
        runbook: input.runbook,
        sourceMessageId: input.sourceMessageId,
        groupedPhases,
      }),
    ],
  };
}

function buildRunbookTaskQueuePart(input: {
  run: RunbookRunForMessage;
  runbook: RunbookDefinition;
  sourceMessageId: string;
  groupedPhases: Array<{
    id: string;
    title: string;
    tasks: Array<{
      id: string;
      key: string;
      title: string;
      status: string;
      dependsOn: unknown;
      sortOrder: number;
    }>;
  }>;
}): RunbookMessagePart {
  const data: TaskQueueData = {
    queueId: input.run.id,
    title: input.runbook.catalog.displayName,
    status: input.run.status,
    source: {
      type: "runbook",
      id: input.run.id,
      slug: input.runbook.slug,
    },
    summary: "Working through the approved runbook queue.",
    groups: input.groupedPhases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      items: phase.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        metadata: {
          taskKey: task.key,
          dependsOn: task.dependsOn,
          sortOrder: task.sortOrder,
          runbookSlug: input.runbook.slug,
          runbookVersion: input.runbook.version,
          sourceMessageId: input.sourceMessageId,
        },
      })),
    })),
  };
  return taskQueuePart({ queueId: input.run.id, data }) as RunbookMessagePart;
}

export function buildRunbookAmbiguityMessage(input: {
  candidates: Array<{ runbook: RunbookDefinition; confidence: number }>;
}) {
  const names = input.candidates
    .map((candidate) => candidate.runbook.catalog.displayName)
    .join(", ");
  const content = `I found more than one possible runbook: ${names}. Please name the runbook you want me to run.`;
  return {
    content,
    parts: [
      textPart("runbook-ambiguity", content),
      dataPart("runbook-confirmation", "ambiguous", {
        mode: "choice",
        candidates: input.candidates.map((candidate) => ({
          runbookSlug: candidate.runbook.slug,
          displayName: candidate.runbook.catalog.displayName,
          description: candidate.runbook.catalog.description,
          confidence: candidate.confidence,
        })),
      }),
    ],
  };
}

export function buildRunbookUnavailableMessage(input: {
  runbook: RunbookDefinition;
}) {
  const content = `${input.runbook.catalog.displayName} is published but not currently available for this workspace. I will continue with the normal Computer flow instead.`;
  return {
    content,
    parts: [textPart("runbook-unavailable", content)],
  };
}

function textPart(id: string, text: string): RunbookMessagePart {
  return { type: "text", id, text };
}

function dataPart(
  channel: "runbook-confirmation",
  id: string,
  data: Record<string, unknown>,
): RunbookMessagePart {
  return {
    type: `data-${channel}` as const,
    id: `${channel}:${id}`,
    data,
  };
}
