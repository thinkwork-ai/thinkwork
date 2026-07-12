import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Button, Textarea } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { RoutineExecutionDetailView } from "@/components/settings/SettingsRoutineExecutionDetail";
import { StatusBadge } from "@/components/StatusBadge";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  ResolveWorkflowApprovalMutation,
  SettingsWorkflowRunQuery,
} from "@/lib/graphql-queries";
import {
  WorkflowEvidencePanel,
  type WorkflowEvidenceItem,
} from "./WorkflowEvidencePanel";
import {
  preflightPlanFromEvidence,
  WorkflowPlanReview,
  type ApprovalOverridePayload,
} from "./WorkflowPlanReview";
import { WorkflowRunTimeline } from "./WorkflowRunTimeline";
import {
  DefinitionList,
  formatDateTime,
  formatDuration,
  InfoCard,
  JsonPreview,
  jsonRecord,
  nestedString,
  sourceLabel,
  titleize,
  type WorkflowBinding,
} from "./workflow-ui";

type WorkflowRunDetailData = {
  workflowRun?: {
    id: string;
    workflowId: string;
    workflow?: {
      id: string;
      name: string;
      slug: string;
    } | null;
    workflowVersion?: {
      id: string;
      versionNumber: number;
      versionStatus: string;
      sourceKind: string;
      routineAslVersionId?: string | null;
    } | null;
    engineBinding?: WorkflowBinding | null;
    status: string;
    triggerFamily: string;
    triggerSource?: string | null;
    actorType?: string | null;
    actorId?: string | null;
    idempotencyKey?: string | null;
    correlationId?: string | null;
    backendExecutionId?: string | null;
    backendExecutionRef?: unknown;
    capabilitySnapshot?: unknown;
    readinessSnapshot?: unknown;
    inputSummary?: unknown;
    outputSummary?: unknown;
    startedAt?: string | null;
    finishedAt?: string | null;
    lastEventAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    totalCostUsdCents?: number | null;
    events: Array<{
      id: string;
      eventType: string;
      eventStatus?: string | null;
      provenance: string;
      occurredAt: string;
      message?: string | null;
      payloadSummary?: unknown;
      evidenceRef?: unknown;
    }>;
    evidence: WorkflowEvidenceItem[];
    createdAt: string;
    updatedAt: string;
  } | null;
};

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "cancelled",
  "timed_out",
  "blocked_not_ready",
]);

/**
 * Build a Step Functions console link from an execution ARN, e.g.
 * arn:aws:states:us-east-1:123:execution:machine:name. Returns null when the
 * value is not a states execution ARN.
 */
function stepFunctionsConsoleUrl(executionArn: string): string | null {
  const parts = executionArn.split(":");
  if (parts.length < 6 || parts[0] !== "arn" || parts[2] !== "states") {
    return null;
  }
  const region = parts[3];
  if (!region) return null;
  const base = `https://${region}.console.aws.amazon.com/states/home`;
  const arn = encodeURIComponent(executionArn);
  return `${base}?region=${region}#/v2/executions/details/${arn}`;
}

export function WorkflowRunDetail({
  workflowId,
  runId,
}: {
  workflowId: string;
  runId: string;
}) {
  const [result, refetch] = useQuery<WorkflowRunDetailData>({
    query: SettingsWorkflowRunQuery,
    variables: { id: runId },
    requestPolicy: "cache-and-network",
  });

  const run = result.data?.workflowRun ?? null;
  const isTerminal = run
    ? TERMINAL_STATUSES.has(run.status.toLowerCase())
    : true;
  const isWaitingForHuman = run?.status.toLowerCase() === "waiting_for_human";

  useEffect(() => {
    if (isTerminal) return;
    const timer = setInterval(
      () => refetch({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearInterval(timer);
  }, [isTerminal, refetch]);

  const [approvalState, resolveApproval] = useMutation(
    ResolveWorkflowApprovalMutation,
  );
  const [note, setNote] = useState("");
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const approvalDisabled = approvalState.fetching || approvalError !== null;

  const decide = async (
    approve: boolean,
    decisionNote?: string | null,
    override?: ApprovalOverridePayload | null,
  ) => {
    setApprovalError(null);
    const res = await resolveApproval({
      runId,
      approve,
      note: decisionNote !== undefined ? decisionNote : note.trim() || null,
      override: override ?? null,
    });
    if (res.error) {
      // Narrow-only validation errors surface verbatim (e.g. a stale grant
      // or an over-cap record limit); anything else means the run moved on.
      const validation = res.error.graphQLErrors?.[0]?.message;
      setApprovalError(
        validation && !/waiting/i.test(validation)
          ? validation
          : "This run has already left the waiting state — refresh to see its current status.",
      );
      return;
    }
    refetch({ requestPolicy: "network-only" });
  };

  usePageHeaderActions({
    title: run?.workflow?.name ?? "Workflow run",
    breadcrumbs: [
      { label: "Workflows", href: "/settings/workflows" },
      {
        label: run?.workflow?.name ?? "Workflow",
        href: `/settings/workflows/${workflowId}`,
      },
      { label: `Run ${runId.slice(0, 8)}` },
    ],
    action: run ? <StatusBadge status={run.status.toLowerCase()} /> : undefined,
    actionKey: `workflow-run:${runId}:${run?.status ?? "loading"}`,
  });

  if (result.fetching && !run) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (result.error || !run || run.workflowId !== workflowId) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <InfoCard title="Workflow run not found">
          <p className="text-sm text-muted-foreground">
            {result.error?.message ??
              "This workflow run could not be loaded or does not belong to this workflow."}
          </p>
        </InfoCard>
      </div>
    );
  }

  // THINK-193 U3: a memory workflow's preflight stage records the reviewable
  // plan as step-output evidence; its presence upgrades the approval block
  // into the plan-review editor.
  const preflightPlan = preflightPlanFromEvidence(run.evidence);
  const backendRef = jsonRecord(run.backendExecutionRef);
  const routineId =
    run.engineBinding?.routineId ?? nestedString(backendRef, "routineId");
  const routineExecutionId = nestedString(backendRef, "routineExecutionId");
  const source = sourceLabel(run.engineBinding);
  const executionArn =
    nestedString(backendRef, "executionArn") ??
    (run.backendExecutionId?.startsWith("arn:aws:states:")
      ? run.backendExecutionId
      : null);
  const diagnosticsUrl = executionArn
    ? stepFunctionsConsoleUrl(executionArn)
    : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto p-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <InfoCard title="Run summary">
          <DefinitionList
            items={[
              {
                label: "Status",
                value: (
                  <StatusBadge status={run.status.toLowerCase()} size="sm" />
                ),
              },
              { label: "Workflow", value: run.workflow?.name ?? "—" },
              { label: "Trigger", value: titleize(run.triggerFamily) },
              { label: "Trigger source", value: run.triggerSource ?? "—" },
              { label: "Started", value: formatDateTime(run.startedAt) },
              {
                label: "Duration",
                value: formatDuration(run.startedAt, run.finishedAt),
              },
            ]}
          />
        </InfoCard>
        <InfoCard title="Version and backend">
          <DefinitionList
            items={[
              { label: "Engine", value: source },
              {
                label: "Version",
                value: run.workflowVersion?.versionNumber ?? "—",
              },
              {
                label: "Source kind",
                value: titleize(run.workflowVersion?.sourceKind),
              },
              { label: "Execution ID", value: run.backendExecutionId ?? "—" },
              { label: "Correlation", value: run.correlationId ?? "—" },
              ...(diagnosticsUrl
                ? [
                    {
                      label: "Diagnostics",
                      value: (
                        <a
                          href={diagnosticsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          Open execution
                        </a>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </InfoCard>
      </div>

      {isWaitingForHuman && preflightPlan ? (
        <InfoCard title="Plan review">
          <WorkflowPlanReview
            plan={preflightPlan}
            busy={approvalState.fetching}
            error={approvalError}
            onDecide={(approve, decisionNote, override) =>
              decide(approve, decisionNote, override)
            }
          />
        </InfoCard>
      ) : isWaitingForHuman ? (
        <InfoCard title="Approval required">
          <p className="text-sm text-muted-foreground">
            This run is paused on a human-approval checkpoint. Approve to
            continue the workflow, or deny to cancel the run.
          </p>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add an optional note for the record…"
            rows={2}
            disabled={approvalDisabled}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={approvalDisabled}
              onClick={() => decide(true)}
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={approvalDisabled}
              onClick={() => decide(false)}
            >
              Deny
            </Button>
          </div>
          {approvalError ? (
            <p className="text-sm text-destructive">{approvalError}</p>
          ) : null}
        </InfoCard>
      ) : null}

      {run.errorCode || run.errorMessage ? (
        <InfoCard title="Failure">
          <p className="text-sm text-destructive">
            {[run.errorCode, run.errorMessage].filter(Boolean).join(": ")}
          </p>
        </InfoCard>
      ) : null}

      <InfoCard title="Timeline">
        <WorkflowRunTimeline events={run.events} />
      </InfoCard>

      <WorkflowEvidencePanel evidence={run.evidence} />

      {routineId && routineExecutionId ? (
        <InfoCard title="Step Functions execution">
          <div className="mb-3">
            <p className="text-sm text-muted-foreground">
              Native Step Functions evidence from the routine adapter.
            </p>
          </div>
          <div className="h-[520px] overflow-hidden rounded-md border border-border/70">
            <RoutineExecutionDetailView
              routineId={routineId}
              executionId={routineExecutionId}
              className="p-0"
            />
          </div>
        </InfoCard>
      ) : run.engineBinding?.bindingType === "step_functions_routine" ? (
        <InfoCard title="Step Functions execution">
          <p className="text-sm text-muted-foreground">
            Step Functions evidence is present, but the routine execution link
            is not available yet.
          </p>
        </InfoCard>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <InfoCard title="Input">
          <JsonPreview value={run.inputSummary} />
        </InfoCard>
        <InfoCard title="Output">
          <JsonPreview value={run.outputSummary} />
        </InfoCard>
        <InfoCard title="Readiness snapshot">
          <JsonPreview value={run.readinessSnapshot} />
        </InfoCard>
        <InfoCard title="Backend reference">
          <JsonPreview value={run.backendExecutionRef} />
        </InfoCard>
      </div>
    </div>
  );
}
