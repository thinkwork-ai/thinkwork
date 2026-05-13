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
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { PanelRight } from "lucide-react";
import { RoutineExecutionDetailQuery } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ExecutionGraph,
  type StepEventLite,
} from "@/components/routines/ExecutionGraph";
import {
  StepDetailPanel,
  type StepEventDetail,
} from "@/components/routines/StepDetailPanel";
import {
  normalizeRoutineExecutionManifest,
  parseAwsJson,
} from "@/components/routines/routineExecutionManifest";

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
  const [detailsOpen, setDetailsOpen] = useState(false);

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
  useEffect(() => {
    if (selectedNodeId) return;
    const firstStep =
      manifestSteps[0]?.nodeId ?? execution?.stepEvents[0]?.nodeId ?? null;
    if (firstStep) setSelectedNodeId(firstStep);
  }, [execution?.stepEvents, manifestSteps, selectedNodeId]);

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
      <PageLayout header={<PageHeader title="Execution not found" />}>
        <Card>
          <CardContent className="py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {error?.message ?? "No execution row matches that id."}
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  if (execution.routineId !== routineId) {
    return (
      <PageLayout header={<PageHeader title="Execution not found" />}>
        <Card>
          <CardContent className="py-6 text-sm text-zinc-500 dark:text-zinc-400">
            That execution does not belong to this routine.
          </CardContent>
        </Card>
      </PageLayout>
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
  const executionOutput = parseAwsJson(execution.outputJson);
  const renderStepDetails = () =>
    selectedNodeId ? (
      <StepDetailPanel
        nodeId={selectedNodeId}
        step={selectedStep}
        events={eventsForSelected}
        executionOutput={executionOutput}
        className="h-full rounded-none border-0 bg-transparent shadow-none"
      />
    ) : (
      <Card className="h-full rounded-none border-0 bg-transparent shadow-none">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Select a step to see its result.
        </CardContent>
      </Card>
    );

  return (
    <PageLayout
      contentClassName="overflow-hidden pb-4"
      header={
        <PageHeader
          title={routine?.name ?? "Execution"}
          description={`Execution ${executionId.slice(0, 8)} · ${execution.triggerSource}`}
          actions={<StatusBadge status={execution.status.toLowerCase()} />}
        />
      }
    >
      <div className="flex h-full min-h-0 gap-3">
        <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border/80 bg-background">
          <ExecutionGraph
            aslJson={aslVersion?.aslJson}
            stepManifest={stepManifest}
            stepEvents={stepEventsLite}
            executionStatus={execution.status}
            executionOutput={executionOutput}
            selectedNodeId={selectedNodeId}
            onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
            className="h-full min-h-0 rounded-none border-0"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="absolute right-3 top-3 z-20 xl:hidden"
            onClick={() => setDetailsOpen(true)}
          >
            <PanelRight className="h-3.5 w-3.5" />
            Details
          </Button>
        </div>
        <div className="hidden h-full min-h-0 w-[440px] shrink-0 overflow-y-auto rounded-md border border-border/70 bg-card/95 backdrop-blur xl:block">
          {renderStepDetails()}
        </div>
      </div>
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-[min(460px,calc(100vw-2rem))]">
          <SheetHeader className="border-b border-border/70 pr-12">
            <SheetTitle>Step result</SheetTitle>
            <SheetDescription>
              Inspect the selected execution step.
            </SheetDescription>
          </SheetHeader>
          {renderStepDetails()}
        </SheetContent>
      </Sheet>
    </PageLayout>
  );
}
