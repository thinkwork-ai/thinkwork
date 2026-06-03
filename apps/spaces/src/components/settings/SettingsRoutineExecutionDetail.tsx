import { useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "urql";
import { PanelRight } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { RoutineExecutionDetailQuery } from "@/lib/routine-queries";
import { StatusBadge } from "@/components/StatusBadge";
import { LoadingShimmer } from "@/components/LoadingShimmer";
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

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export function SettingsRoutineExecutionDetail() {
  const { routineId, executionId } = useParams({
    from: "/_authed/settings/routines/$routineId_/executions/$executionId",
  });
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

  useEffect(() => {
    if (isTerminal || !executionId) return;
    const t = setInterval(
      () => refetchExecution({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearInterval(t);
  }, [isTerminal, executionId, refetchExecution]);

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

  usePageHeaderActions({
    title: routine?.name ?? "Execution",
    breadcrumbs: routine
      ? [
          { label: "Routines", href: "/settings/routines" },
          { label: routine.name, href: `/settings/routines/${routineId}` },
          { label: `Run ${executionId.slice(0, 8)}` },
        ]
      : [{ label: "Routines", href: "/settings/routines" }],
    action: execution ? (
      <StatusBadge status={execution.status.toLowerCase()} />
    ) : undefined,
    actionKey: `exec:${executionId}:${execution?.status ?? "loading"}`,
  });

  if (fetching && !execution) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }
  if (error || !execution || execution.routineId !== routineId) {
    return (
      <div className="w-full px-6 pb-10 pt-6">
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {error?.message ??
              "This execution could not be loaded, or it does not belong to this routine."}
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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-6">
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
    </div>
  );
}
