import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { ArrowRight, RefreshCw, Zap } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import {
  RebuildRoutineVersionMutation,
  RoutineDetailQuery,
  TriggerRoutineRunMutation,
} from "@/lib/graphql-queries";
import {
  ExecutionList,
  parseStatusFilter,
  type StatusFilterId,
} from "@/components/routines/ExecutionList";
import { RoutineDefinitionPanel } from "@/components/routines/RoutineDefinitionPanel";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/routines/$routineId",
)({
  component: RoutineDetailPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { status?: StatusFilterId } => {
    // Phase D U14: Status filter pills persist via URL search params so
    // a reload preserves the operator's view. parseStatusFilter()
    // normalizes any unknown value (e.g., a typoed deep-link) back to
    // "all" rather than rendering an unknown filter pill as active.
    const status = parseStatusFilter(search.status);
    return status === "all" ? {} : { status };
  },
});

function RoutineDetailPage() {
  const { routineId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const statusFilter: StatusFilterId = parseStatusFilter(search.status);

  const [result, reexecuteRoutine] = useQuery({
    query: RoutineDetailQuery,
    variables: { id: routineId },
  });
  const [triggerState, executeTrigger] = useMutation(TriggerRoutineRunMutation);
  const [rebuildState, executeRebuild] = useMutation(
    RebuildRoutineVersionMutation,
  );
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [lastTestRun, setLastTestRun] = useState<{
    id: string;
    status: string;
  } | null>(null);
  const [executionRefreshKey, setExecutionRefreshKey] = useState(0);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);

  const handleRunNow = async () => {
    setTriggerError(null);
    setLastTestRun(null);
    const res = await executeTrigger({ routineId, input: null });
    if (res.error) {
      setTriggerError(res.error.message.replace(/^\[GraphQL\]\s*/, ""));
      return;
    }
    const execution = res.data?.triggerRoutineRun;
    if (execution) {
      setLastTestRun({ id: execution.id, status: execution.status });
      setExecutionRefreshKey((key) => key + 1);
    }
  };

  const handleRebuild = async () => {
    setRebuildError(null);
    setRebuildMessage(null);
    const res = await executeRebuild({ input: { routineId } });
    if (res.error) {
      setRebuildError(res.error.message.replace(/^\[GraphQL\]\s*/, ""));
      return;
    }
    const version = res.data?.rebuildRoutineVersion.versionNumber;
    setRebuildMessage(
      version ? `Rebuilt version ${version}.` : "Routine rebuilt.",
    );
    reexecuteRoutine({ requestPolicy: "network-only" });
  };

  const routine = result.data?.routine;
  useBreadcrumbs([
    { label: "Routines", href: "/automations/routines" },
    { label: routine?.name ?? "Loading..." },
  ]);

  if (result.fetching || !routine) return <PageSkeleton />;

  const actions = (
    <>
      {routine.engine === "step_functions" && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleRebuild}
          disabled={rebuildState.fetching || triggerState.fetching}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {rebuildState.fetching ? "Rebuilding..." : "Rebuild"}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={handleRunNow}
        disabled={triggerState.fetching || rebuildState.fetching}
      >
        <Zap className="h-3.5 w-3.5" />
        {triggerState.fetching ? "Starting..." : "Test Routine"}
      </Button>
    </>
  );

  return (
    <PageLayout
      header={
        <PageHeader
          title={routine.name}
          description={routine.description ?? undefined}
          actions={actions}
        />
      }
    >
      {rebuildMessage && (
        <p className="mb-3 text-sm text-muted-foreground">{rebuildMessage}</p>
      )}
      {rebuildError && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">
          {rebuildError}
        </p>
      )}
      {triggerError && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">
          {triggerError}
        </p>
      )}
      {lastTestRun && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/50 px-4 py-3 text-sm">
          <div className="min-w-0">
            <div className="font-medium">Test run started</div>
            <div className="mt-0.5 text-muted-foreground">
              Run {lastTestRun.id.slice(0, 8)} is now visible in the run list.
            </div>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/automations/routines/$routineId/executions/$executionId"
              params={{ routineId, executionId: lastTestRun.id }}
            >
              View run output
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      )}

      <RoutineDefinitionPanel
        routineId={routineId}
        onPublished={() => reexecuteRoutine({ requestPolicy: "network-only" })}
      />

      <ExecutionList
        routineId={routineId}
        statusFilter={statusFilter}
        onStatusFilterChange={(next) =>
          navigate({
            to: "/automations/routines/$routineId",
            params: { routineId },
            search: next === "all" ? {} : { status: next },
            replace: true,
          })
        }
        emptyCta={
          statusFilter === "all" ? (
            <Button size="sm" asChild>
              <Link to="/automations/schedules" search={{ type: "routine" }}>
                Set up a trigger
              </Link>
            </Button>
          ) : null
        }
        refreshKey={executionRefreshKey}
      />
    </PageLayout>
  );
}
