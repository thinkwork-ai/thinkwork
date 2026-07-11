import type {
  AgentLoopRow,
  AgentLoopRunSummary,
  LinkedWorkflowRunSummary,
} from "@/components/agent-loops/agent-loop-types";

export type WorkflowExecutionSource = "workflow" | "agent_loop";

export interface WorkflowExecutionSummary {
  id: string;
  source: WorkflowExecutionSource;
  status: string;
  triggerFamily: string;
  triggerSource?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  backendExecutionId?: string | null;
  threadId?: string | null;
  currentIteration?: number | null;
  totalCostUsdCents?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export function automationRunTarget(loop: AgentLoopRow): {
  kind: "workflow" | "agent_loop";
  id: string;
} {
  return loop.linkedWorkflow?.id &&
    loop.linkedWorkflow.readinessState === "ready"
    ? { kind: "workflow", id: loop.linkedWorkflow.id }
    : { kind: "agent_loop", id: loop.id };
}

export function mergeAutomationExecutions(
  workflowRuns: LinkedWorkflowRunSummary[] = [],
  legacyRuns: AgentLoopRunSummary[] = [],
): WorkflowExecutionSummary[] {
  const canonical = workflowRuns.map(normalizeWorkflowRun);
  const canonicalKeys = new Set(
    canonical
      .flatMap(explicitKeys)
      .filter((key): key is string => Boolean(key)),
  );
  const legacy = legacyRuns
    .map(normalizeLegacyRun)
    .filter(
      (run) => !explicitKeys(run).some((key) => key && canonicalKeys.has(key)),
    );
  return [...canonical, ...legacy].sort(
    (left, right) => executionTime(right) - executionTime(left),
  );
}

function normalizeWorkflowRun(
  run: LinkedWorkflowRunSummary,
): WorkflowExecutionSummary {
  return {
    ...run,
    source: "workflow",
    createdAt: run.createdAt ?? run.startedAt ?? new Date(0).toISOString(),
    status: normalizeStatus(run.status),
  };
}

function normalizeLegacyRun(
  run: AgentLoopRunSummary,
): WorkflowExecutionSummary {
  return {
    id: run.id,
    source: "agent_loop",
    status: normalizeStatus(run.status),
    triggerFamily: run.triggerFamily,
    triggerSource: run.triggerSource,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    correlationId: run.correlationId,
    idempotencyKey: run.idempotencyKey,
    threadId: run.threadId,
    currentIteration: run.currentIteration,
    totalCostUsdCents: run.totalCostUsdCents,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
  };
}

function normalizeStatus(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "succeeded";
    case "budget_stopped":
    case "escalated":
    case "skipped":
      return "failed";
    default:
      return status.toLowerCase();
  }
}

function explicitKeys(run: WorkflowExecutionSummary): Array<string | null> {
  return [
    run.correlationId ? `correlation:${run.correlationId}` : null,
    run.idempotencyKey ? `idempotency:${run.idempotencyKey}` : null,
    run.backendExecutionId ? `backend:${run.backendExecutionId}` : null,
  ];
}

function executionTime(run: WorkflowExecutionSummary): number {
  const value = run.startedAt ?? run.createdAt;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}
