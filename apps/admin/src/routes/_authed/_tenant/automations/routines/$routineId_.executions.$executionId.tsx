/**
 * Routine execution run-detail page (Plan 2026-05-01-007 §U13).
 *
 * /automations/routines/:routineId/executions/:executionId
 *
 * One GraphQL fetch (`RoutineExecutionDetail`) pulls execution metadata,
 * step events, and the routine's latest markdown summary. A second
 * fetch keyed on `routine.currentVersion` retrieves the step manifest
 * from the latest published `routine_asl_versions` row so the graph can
 * render even when no step events have landed yet.
 *
 * Live updates: poll every 5s while the execution status is non-terminal.
 * The plan acknowledges that AppSync subscription wiring for routine
 * step events is deferred to a follow-up; polling at 5s is acceptable
 * per the Implementation-Time Unknowns section of the plan.
 */

import { useState, useMemo, useEffect } from "react";
import type React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ArrowLeft } from "lucide-react";
import { RoutineExecutionDetailQuery } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ExecutionGraph,
  type StepEventLite,
} from "@/components/routines/ExecutionGraph";
import {
  StepDetailPanel,
  type StepEventDetail,
} from "@/components/routines/StepDetailPanel";
import { MarkdownSummary } from "@/components/routines/MarkdownSummary";
import {
  normalizeRoutineExecutionManifest,
  parseAwsJson,
} from "@/components/routines/routineExecutionManifest";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/routines/$routineId_/executions/$executionId",
)({
  component: ExecutionDetailPage,
});

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function ExecutionDetailPage() {
  const { routineId, executionId } = Route.useParams();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [{ data, fetching, error }, refetchExecution] = useQuery({
    query: RoutineExecutionDetailQuery,
    variables: { id: executionId },
    requestPolicy: "cache-and-network",
  });

  const execution = data?.routineExecution;
  const routine = execution?.routine ?? null;
  const isTerminal = execution
    ? TERMINAL_STATUSES.has(execution.status)
    : false;

  // Poll while non-terminal. The plan justifies polling-as-default for
  // U13: AppSync subscription wiring for routine_step_events stays out
  // of scope until the existing OnThreadTurnUpdatedSubscription pattern
  // can be extended cleanly to step events.
  useEffect(() => {
    if (isTerminal || !executionId) return;
    const t = setInterval(
      () => refetchExecution({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearInterval(t);
  }, [isTerminal, executionId, refetchExecution]);

  // Step manifest is now embedded on the execution via the
  // RoutineExecution.aslVersion resolver field (schema follow-up bundle).
  // The resolver matches by (state_machine_arn, version_arn) so each
  // execution renders against the manifest that *actually* backed it,
  // not the routine's current version. Falls back to events-only graph
  // rendering when versionArn is null (out-of-band SFN starts).
  const aslVersion = execution?.aslVersion ?? null;
  const stepManifest = aslVersion?.stepManifestJson ?? null;
  const manifestSteps = useMemo(
    () => normalizeRoutineExecutionManifest(stepManifest),
    [stepManifest],
  );

  useBreadcrumbs(
    routine
      ? [
          { label: "Routines", href: "/automations/routines" },
          {
            label: routine.name,
            href: `/automations/routines/${routineId}`,
          },
          { label: `Run ${executionId.slice(0, 8)}` },
        ]
      : [{ label: "Routines", href: "/automations/routines" }],
  );

  if (fetching && !execution) return <PageSkeleton />;
  if (error || !execution) {
    return (
      <div className="space-y-4">
        <PageHeader title="Execution not found" />
        <Card>
          <CardContent className="py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {error?.message ?? "No execution row matches that id."}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (execution.routineId !== routineId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Execution not found" />
        <Card>
          <CardContent className="py-6 text-sm text-zinc-500 dark:text-zinc-400">
            That execution does not belong to this routine.
          </CardContent>
        </Card>
      </div>
    );
  }

  const stepEventsLite: StepEventLite[] = execution.stepEvents.map((ev) => ({
    id: ev.id,
    nodeId: ev.nodeId,
    recipeType: ev.recipeType,
    status: ev.status,
    startedAt: ev.startedAt ?? null,
    finishedAt: ev.finishedAt ?? null,
    retryCount: ev.retryCount,
  }));

  const stepEventsDetail: StepEventDetail[] = execution.stepEvents.map(
    (ev) => ({
      id: ev.id,
      nodeId: ev.nodeId,
      recipeType: ev.recipeType,
      status: ev.status,
      startedAt: ev.startedAt ?? null,
      finishedAt: ev.finishedAt ?? null,
      inputJson: ev.inputJson ?? null,
      outputJson: ev.outputJson ?? null,
      errorJson: ev.errorJson ?? null,
      llmCostUsdCents: ev.llmCostUsdCents ?? null,
      retryCount: ev.retryCount,
      stdoutS3Uri: ev.stdoutS3Uri ?? null,
      stderrS3Uri: ev.stderrS3Uri ?? null,
      stdoutPreview: ev.stdoutPreview ?? null,
      truncated: ev.truncated,
      createdAt: ev.createdAt,
    }),
  );

  const eventsForSelected = selectedNodeId
    ? stepEventsDetail
        .filter((ev) => ev.nodeId === selectedNodeId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  const selectedStep = selectedNodeId
    ? manifestSteps.find((step) => step.nodeId === selectedNodeId)
    : undefined;
  const summaryMarkdown =
    aslVersion?.markdownSummary ?? routine?.documentationMd ?? "";
  const executionOutput = parseAwsJson(execution.outputJson);
  const executionInput = parseAwsJson(execution.inputJson);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/automations/routines/$routineId" params={{ routineId }}>
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader
          title={routine?.name ?? "Execution"}
          description={`Execution ${executionId.slice(0, 8)} · ${execution.triggerSource}`}
          actions={<StatusBadge status={execution.status.toLowerCase()} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="space-y-4 py-4">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                Steps
              </h3>
              <ExecutionGraph
                aslJson={aslVersion?.aslJson}
                stepManifest={stepManifest}
                stepEvents={stepEventsLite}
                executionStatus={execution.status}
                executionOutput={executionOutput}
                selectedNodeId={selectedNodeId}
                onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
              />
            </CardContent>
          </Card>

          {selectedNodeId && (
            <StepDetailPanel
              nodeId={selectedNodeId}
              step={selectedStep}
              events={eventsForSelected}
            />
          )}
        </div>

        <div className="space-y-4">
          {(execution.outputJson != null ||
            execution.errorCode ||
            execution.errorMessage) && (
            <Card>
              <CardContent className="space-y-3 py-4">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  Run result
                </h3>
                {execution.errorCode && (
                  <Row label="Error code" value={execution.errorCode} />
                )}
                {execution.errorMessage && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                    {execution.errorMessage}
                  </div>
                )}
                {execution.outputJson != null && (
                  <JsonBlock value={executionOutput} />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 py-4 text-sm">
              <Row label="Trigger" value={execution.triggerSource} />
              <Row
                label="Started"
                value={
                  execution.startedAt
                    ? `${formatDateTime(execution.startedAt)} (${relativeTime(execution.startedAt)})`
                    : "—"
                }
              />
              <Row
                label="Finished"
                value={
                  execution.finishedAt
                    ? `${formatDateTime(execution.finishedAt)} (${relativeTime(execution.finishedAt)})`
                    : "—"
                }
              />
              <Row
                label="LLM cost"
                value={
                  execution.totalLlmCostUsdCents != null
                    ? execution.totalLlmCostUsdCents < 100
                      ? `${execution.totalLlmCostUsdCents}¢`
                      : `$${(execution.totalLlmCostUsdCents / 100).toFixed(2)}`
                    : "—"
                }
              />
              {execution.errorCode && (
                <Row label="Error" value={execution.errorCode} />
              )}
              {execution.inputJson != null && (
                <Section title="Input">
                  <JsonBlock value={executionInput} />
                </Section>
              )}
            </CardContent>
          </Card>

          {summaryMarkdown.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  Version summary
                </h3>
                <MarkdownSummary
                  markdown={summaryMarkdown}
                  onAnchorClick={(nodeId) => setSelectedNodeId(nodeId)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  let pretty: string;
  try {
    pretty = JSON.stringify(value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <pre className="max-h-64 overflow-auto rounded bg-zinc-50 p-2 text-xs leading-snug dark:bg-zinc-900 dark:text-zinc-200">
      {pretty}
    </pre>
  );
}

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {title}
      </div>
      {children}
    </div>
  );
}
