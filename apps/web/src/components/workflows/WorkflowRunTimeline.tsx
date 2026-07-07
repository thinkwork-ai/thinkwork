import { useEffect, useMemo, useState } from "react";
import { Badge, cn } from "@thinkwork/ui";
import {
  formatDateTime,
  formatDuration,
  jsonRecord,
  titleize,
} from "./workflow-ui";

/**
 * WorkflowRunTimeline — folds the raw workflow_run_events ledger into
 * iteration groups and per-step rows (THINK-219 U8).
 *
 * The interpreter writes flat, safe-scalar events (workflow-step-dispatch +
 * workflow-step-finalize). We reconstruct the operator-facing story client
 * side: group by (stepId, iteration), collapse the duplicate
 * workflow_step_finished the finalize hook AND the interpreter both write —
 * keeping the evidence-bearing one — and render policy/approval/rollover
 * events as iteration-level markers. An in-progress step ticks its elapsed
 * time, visually distinct from a settled duration.
 */

export type WorkflowTimelineEvent = {
  id: string;
  eventType: string;
  eventStatus?: string | null;
  provenance?: string | null;
  occurredAt: string;
  message?: string | null;
  payloadSummary?: unknown;
};

type StepStatus = "running" | "completed" | "failed";

interface StepRow {
  stepId: string;
  stepKind?: string;
  startedAt?: string;
  finishedAt?: string;
  status: StepStatus;
  summary?: string;
  errorSummary?: string;
  tokensUsed?: number;
  hasEvidence: boolean;
}

type ExtraEntry =
  | {
      kind: "policy";
      occurredAt: string;
      stepId?: string;
      decision?: string;
      reason?: string;
      summary?: string;
      errorSummary?: string;
      tokensUsed?: number;
    }
  | {
      kind: "approval";
      occurredAt: string;
      decision?: string;
      summary?: string;
    }
  | {
      kind: "rollover";
      occurredAt: string;
      supersededExecutionArn?: string;
      reason?: string;
    }
  | {
      kind: "failure";
      occurredAt: string;
      reason?: string;
      errorSummary?: string;
    }
  | {
      kind: "generic";
      occurredAt: string;
      eventType: string;
      message?: string;
    };

interface IterationGroup {
  iteration: number;
  steps: StepRow[];
  extras: ExtraEntry[];
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Fold the flat event ledger into iteration groups, insertion-ordered. */
export function foldTimeline(
  events: WorkflowTimelineEvent[],
): IterationGroup[] {
  const sorted = [...events].sort((a, b) => {
    const at = new Date(a.occurredAt).getTime();
    const bt = new Date(b.occurredAt).getTime();
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });

  const groups = new Map<number, IterationGroup>();
  const getGroup = (iteration: number): IterationGroup => {
    let group = groups.get(iteration);
    if (!group) {
      group = { iteration, steps: [], extras: [] };
      groups.set(iteration, group);
    }
    return group;
  };
  const getStep = (group: IterationGroup, stepId: string): StepRow => {
    let row = group.steps.find((step) => step.stepId === stepId);
    if (!row) {
      row = { stepId, status: "running", hasEvidence: false };
      group.steps.push(row);
    }
    return row;
  };

  for (const event of sorted) {
    const payload = jsonRecord(event.payloadSummary);
    const iteration = readNumber(payload, "iteration") ?? 0;
    const group = getGroup(iteration);
    const stepId = readString(payload, "stepId");
    const occurredAt = event.occurredAt;

    switch (event.eventType) {
      case "workflow_step_started": {
        if (stepId) {
          const row = getStep(group, stepId);
          row.stepKind ??= readString(payload, "stepKind");
          row.startedAt ??= occurredAt;
        }
        break;
      }
      case "workflow_step_finished": {
        if (stepId) {
          const row = getStep(group, stepId);
          row.stepKind ??= readString(payload, "stepKind");
          const summary = readString(payload, "summary");
          const tokensUsed = readNumber(payload, "tokensUsed");
          const evidence = summary !== undefined || tokensUsed !== undefined;
          // Collapse the finalize-hook + interpreter duplicate: keep the
          // evidence-bearing event's timestamp and payload.
          if (!row.finishedAt || (evidence && !row.hasEvidence)) {
            row.finishedAt = occurredAt;
            if (summary !== undefined) row.summary = summary;
            if (tokensUsed !== undefined) row.tokensUsed = tokensUsed;
            row.hasEvidence = row.hasEvidence || evidence;
          }
          if (row.status !== "failed") row.status = "completed";
        }
        break;
      }
      case "workflow_step_failed": {
        if (stepId) {
          const row = getStep(group, stepId);
          row.stepKind ??= readString(payload, "stepKind");
          row.finishedAt = occurredAt;
          row.status = "failed";
          const errorSummary = readString(payload, "errorSummary");
          if (errorSummary) row.errorSummary = errorSummary;
        } else {
          group.extras.push({
            kind: "failure",
            occurredAt,
            reason: readString(payload, "reason"),
            errorSummary: readString(payload, "errorSummary"),
          });
        }
        break;
      }
      case "workflow_policy_decision": {
        group.extras.push({
          kind: "policy",
          occurredAt,
          stepId,
          decision: readString(payload, "decision"),
          reason: readString(payload, "reason"),
          summary: readString(payload, "summary"),
          errorSummary: readString(payload, "errorSummary"),
          tokensUsed: readNumber(payload, "tokensUsed"),
        });
        break;
      }
      case "workflow_approval_decision": {
        group.extras.push({
          kind: "approval",
          occurredAt,
          decision: readString(payload, "decision"),
          summary: readString(payload, "summary"),
        });
        break;
      }
      case "workflow_run_rollover": {
        group.extras.push({
          kind: "rollover",
          occurredAt,
          supersededExecutionArn: readString(payload, "supersededExecutionArn"),
          reason: readString(payload, "reason"),
        });
        break;
      }
      default: {
        group.extras.push({
          kind: "generic",
          occurredAt,
          eventType: event.eventType,
          message: event.message ?? undefined,
        });
      }
    }
  }

  const result = Array.from(groups.values());
  for (const group of result) {
    group.extras.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
  }
  result.sort((a, b) => a.iteration - b.iteration);
  return result;
}

function stepIsInProgress(step: StepRow): boolean {
  return step.status === "running" && !step.finishedAt;
}

const STEP_BADGE: Record<StepStatus, string> = {
  running:
    "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  completed: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function WorkflowRunTimeline({
  events,
}: {
  events: WorkflowTimelineEvent[];
}) {
  const groups = useMemo(() => foldTimeline(events), [events]);
  const hasInProgress = useMemo(
    () => groups.some((group) => group.steps.some(stepIsInProgress)),
    [groups],
  );

  // Tick the elapsed clock for in-progress steps. Gated so a settled run does
  // no work.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasInProgress) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasInProgress]);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No workflow steps have run yet.
      </p>
    );
  }

  const multiIteration = groups.length > 1;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.iteration} className="space-y-2">
          {multiIteration ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Iteration {group.iteration + 1}
            </div>
          ) : null}
          <ol className="space-y-2">
            {group.steps.map((step) => (
              <li
                key={`${group.iteration}:${step.stepId}`}
                className="rounded-md border border-border/70 p-3"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {step.stepId}
                  </span>
                  {step.stepKind ? (
                    <Badge variant="outline" className="text-xs">
                      {titleize(step.stepKind)}
                    </Badge>
                  ) : null}
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-transparent text-xs font-medium",
                      STEP_BADGE[step.status],
                    )}
                  >
                    {titleize(step.status)}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {stepIsInProgress(step) && step.startedAt ? (
                      <span
                        data-testid="step-elapsed"
                        className="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-300"
                      >
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
                        {formatDuration(
                          step.startedAt,
                          new Date(nowMs).toISOString(),
                        )}{" "}
                        elapsed
                      </span>
                    ) : (
                      <span data-testid="step-duration">
                        {formatDuration(step.startedAt, step.finishedAt)}
                      </span>
                    )}
                  </span>
                </div>
                {step.summary ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {step.summary}
                  </p>
                ) : null}
                {step.errorSummary ? (
                  <p className="mt-2 text-sm text-destructive">
                    {step.errorSummary}
                  </p>
                ) : null}
                {typeof step.tokensUsed === "number" ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {step.tokensUsed.toLocaleString()} tokens
                  </p>
                ) : null}
              </li>
            ))}
            {group.extras.map((extra, index) => (
              <li key={`${group.iteration}:extra:${index}`}>
                <TimelineExtra entry={extra} />
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function TimelineExtra({ entry }: { entry: ExtraEntry }) {
  switch (entry.kind) {
    case "policy":
      return (
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Policy decision
            </Badge>
            {entry.decision ? (
              <span className="text-sm font-medium text-foreground">
                {titleize(entry.decision)}
              </span>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDateTime(entry.occurredAt)}
            </span>
          </div>
          {entry.reason ? (
            <p className="mt-2 text-sm text-muted-foreground">{entry.reason}</p>
          ) : null}
          {entry.summary ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {entry.summary}
            </p>
          ) : null}
          {entry.errorSummary ? (
            <p className="mt-1 text-sm text-destructive">{entry.errorSummary}</p>
          ) : null}
        </div>
      );
    case "approval":
      return (
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Operator decision
            </Badge>
            <span className="text-sm font-medium text-foreground">
              {entry.decision === "rejected" ? "Denied" : "Approved"}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDateTime(entry.occurredAt)}
            </span>
          </div>
          {entry.summary ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {entry.summary}
            </p>
          ) : null}
        </div>
      );
    case "rollover":
      return (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
          <span>Run rolled over to a fresh execution</span>
          <span className="ml-auto">{formatDateTime(entry.occurredAt)}</span>
        </div>
      );
    case "failure":
      return (
        <div className="rounded-md border border-destructive/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-transparent bg-red-50 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              Failed
            </Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDateTime(entry.occurredAt)}
            </span>
          </div>
          <p className="mt-2 text-sm text-destructive">
            {entry.errorSummary ?? entry.reason ?? "The run failed."}
          </p>
        </div>
      );
    case "generic":
      return (
        <div className="rounded-md border border-border/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {titleize(entry.eventType)}
            </Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDateTime(entry.occurredAt)}
            </span>
          </div>
          {entry.message ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {entry.message}
            </p>
          ) : null}
        </div>
      );
  }
}
