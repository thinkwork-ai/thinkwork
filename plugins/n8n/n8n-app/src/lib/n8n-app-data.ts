export type N8nReadinessState =
  | "ready"
  | "blocked_not_ready"
  | "disabled"
  | "unknown";

export type N8nBridgeRun = {
  id: string;
  threadId?: string | null;
  threadTurnId?: string | null;
  status: string;
  resumeStatus: string;
  summary?: string | null;
  errorMessage?: string | null;
  updatedAt: string;
};

export type N8nAppWorkflowRow = {
  externalWorkflowId: string;
  name: string;
  active?: boolean | null;
  triggerTypes: string[];
  lastModifiedAt?: string | null;
  lastExecutionAt?: string | null;
  connectedWorkflowId?: string | null;
  connectedBindingId?: string | null;
  readinessState: N8nReadinessState;
  readinessReasons: unknown;
  nativeWorkflowUrl?: string | null;
  warnings: string[];
};

export type N8nAppExecutionRow = {
  externalExecutionId: string;
  externalWorkflowId: string;
  workflowName?: string | null;
  status: string;
  mode?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  failureMessage?: string | null;
  nativeExecutionUrl: string;
  nativeWorkflowUrl: string;
  bridgeRuns: N8nBridgeRun[];
  warnings: string[];
};

export type N8nAppData = {
  installId: string;
  workflowReadinessState: N8nReadinessState;
  workflowReadinessReasons: unknown;
  executionReadinessState: N8nReadinessState;
  executionReadinessReasons: unknown;
  nativeBaseUrl?: string | null;
  workflows: N8nAppWorkflowRow[];
  executions: N8nAppExecutionRow[];
};

export type N8nAppViewMode = "workflows" | "executions";

export function filterN8nWorkflows(
  workflows: N8nAppWorkflowRow[],
  query: string,
  readiness: "all" | N8nReadinessState = "all",
): N8nAppWorkflowRow[] {
  const normalizedQuery = normalizeSearch(query);
  return workflows.filter((workflow) => {
    if (readiness !== "all" && workflow.readinessState !== readiness) {
      return false;
    }
    if (!normalizedQuery) return true;
    return searchableWorkflowText(workflow).includes(normalizedQuery);
  });
}

export function filterN8nExecutions(
  executions: N8nAppExecutionRow[],
  query: string,
  status: "all" | string = "all",
): N8nAppExecutionRow[] {
  const normalizedQuery = normalizeSearch(query);
  const normalizedStatus = normalizeSearch(status);
  return executions.filter((execution) => {
    if (
      status !== "all" &&
      normalizeSearch(execution.status) !== normalizedStatus
    ) {
      return false;
    }
    if (!normalizedQuery) return true;
    return searchableExecutionText(execution).includes(normalizedQuery);
  });
}

export function executionStatuses(
  executions: N8nAppExecutionRow[],
): string[] {
  return Array.from(
    new Set(
      executions
        .map((execution) => execution.status.trim())
        .filter((status) => status.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export function readinessLabel(state: N8nReadinessState): string {
  if (state === "ready") return "ready";
  if (state === "blocked_not_ready") return "blocked";
  if (state === "disabled") return "disabled";
  return "unknown";
}

export function connectionLabel(workflow: N8nAppWorkflowRow): string {
  if (workflow.connectedWorkflowId && workflow.connectedBindingId) {
    return "linked";
  }
  if (workflow.connectedWorkflowId || workflow.connectedBindingId) {
    return "partial";
  }
  return "unlinked";
}

export function formatDuration(durationMs?: number | null): string {
  if (durationMs == null) return "-";
  if (durationMs < 1000) return `${durationMs} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function bridgeThreadPath(run: N8nBridgeRun): string | null {
  if (!run.threadId) return null;
  return `/threads/${run.threadId}`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function searchableWorkflowText(workflow: N8nAppWorkflowRow): string {
  return normalizeSearch(
    [
      workflow.name,
      workflow.externalWorkflowId,
      workflow.triggerTypes.join(" "),
      workflow.readinessState,
      connectionLabel(workflow),
      workflow.warnings.join(" "),
    ].join(" "),
  );
}

function searchableExecutionText(execution: N8nAppExecutionRow): string {
  return normalizeSearch(
    [
      execution.externalExecutionId,
      execution.externalWorkflowId,
      execution.workflowName ?? "",
      execution.status,
      execution.mode ?? "",
      execution.failureMessage ?? "",
      execution.bridgeRuns
        .map((run) =>
          [
            run.id,
            run.status,
            run.resumeStatus,
            run.summary ?? "",
            run.errorMessage ?? "",
          ].join(" "),
        )
        .join(" "),
      execution.warnings.join(" "),
    ].join(" "),
  );
}
