import { useEffect } from "react";
import { useQuery } from "urql";
import { Badge } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { RoutineExecutionDetailView } from "@/components/settings/SettingsRoutineExecutionDetail";
import { StatusBadge } from "@/components/StatusBadge";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsWorkflowRunQuery } from "@/lib/graphql-queries";
import {
  WorkflowEvidencePanel,
  type WorkflowEvidenceItem,
} from "./WorkflowEvidencePanel";
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

  useEffect(() => {
    if (isTerminal) return;
    const timer = setInterval(
      () => refetch({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearInterval(timer);
  }, [isTerminal, refetch]);

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

  const backendRef = jsonRecord(run.backendExecutionRef);
  const routineId =
    run.engineBinding?.routineId ?? nestedString(backendRef, "routineId");
  const routineExecutionId = nestedString(backendRef, "routineExecutionId");
  const source = sourceLabel(run.engineBinding);

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
            ]}
          />
        </InfoCard>
      </div>

      {run.errorCode || run.errorMessage ? (
        <InfoCard title="Failure">
          <p className="text-sm text-destructive">
            {[run.errorCode, run.errorMessage].filter(Boolean).join(": ")}
          </p>
        </InfoCard>
      ) : null}

      <InfoCard title="Timeline">
        {run.events.length ? (
          <ol className="space-y-3">
            {run.events.map((event) => (
              <li
                key={event.id}
                className="rounded-md border border-border/70 p-3"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {titleize(event.eventType)}
                  </Badge>
                  {event.eventStatus ? (
                    <Badge variant="outline" className="text-xs">
                      {titleize(event.eventStatus)}
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(event.occurredAt)}
                  </span>
                </div>
                {event.message ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {event.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            No run events have been recorded yet.
          </p>
        )}
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
