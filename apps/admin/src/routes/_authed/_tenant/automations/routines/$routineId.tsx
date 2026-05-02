import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { RefreshCw, Zap } from "lucide-react";
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

export const Route = createFileRoute("/_authed/_tenant/automations/routines/$routineId")({
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
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);

  const handleRunNow = async () => {
    setTriggerError(null);
    const res = await executeTrigger({ routineId, input: null });
    if (res.error) {
      setTriggerError(res.error.message.replace(/^\[GraphQL\]\s*/, ""));
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
      />
    </PageLayout>
  );
}
