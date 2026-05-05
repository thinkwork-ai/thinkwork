import { useCallback, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { ArrowRight, RefreshCw, Zap } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  RoutineDefinitionPanel,
  type RoutineDefinitionEditorState,
} from "@/components/routines/RoutineDefinitionPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/utils";

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

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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
  const [definitionState, setDefinitionState] =
    useState<RoutineDefinitionEditorState>({
      ready: false,
      dirty: false,
      invalid: false,
      saving: false,
      currentVersion: null,
    });

  const handleDefinitionStateChange = useCallback(
    (next: RoutineDefinitionEditorState) => setDefinitionState(next),
    [],
  );

  const testDisabledReason = definitionState.saving
    ? "Wait for the workflow save to finish before testing."
    : definitionState.dirty
      ? "Save workflow changes before testing this version."
      : definitionState.invalid
        ? "Fix configuration issues before testing."
        : !definitionState.ready
          ? "Wait for the workflow definition to load before testing."
          : null;

  const handleRunNow = async () => {
    if (testDisabledReason) return;
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

  const testDisabled =
    triggerState.fetching ||
    rebuildState.fetching ||
    testDisabledReason != null;

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
        disabled={testDisabled}
        title={testDisabledReason ?? undefined}
      >
        <Zap className="h-3.5 w-3.5" />
        {triggerState.fetching ? "Starting..." : "Test Routine"}
      </Button>
    </>
  );

  return (
    <PageLayout
      contentClassName="overflow-hidden pb-4"
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
              Run {lastTestRun.id.slice(0, 8)} started from the saved workflow.
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

      <Tabs defaultValue="workflow" className="h-full min-h-0 gap-4">
        <TabsList
          variant="line"
          className="w-full shrink-0 justify-start border-b"
        >
          <TabsTrigger value="workflow" className="flex-none px-3">
            Workflow
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex-none px-3">
            Activity
          </TabsTrigger>
          <TabsTrigger value="config" className="flex-none px-3">
            Config
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workflow" className="min-h-0 overflow-hidden">
          <RoutineDefinitionPanel
            routineId={routineId}
            onPublished={() =>
              reexecuteRoutine({ requestPolicy: "network-only" })
            }
            onStateChange={handleDefinitionStateChange}
            layout="workspace"
          />
        </TabsContent>

        <TabsContent value="activity" className="overflow-y-auto">
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
                <Button
                  size="sm"
                  onClick={handleRunNow}
                  disabled={testDisabled}
                  title={testDisabledReason ?? undefined}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Test Routine
                </Button>
              ) : null
            }
            refreshKey={executionRefreshKey}
          />
        </TabsContent>

        <TabsContent value="config" className="space-y-4 overflow-y-auto">
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Definition</h2>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Engine</dt>
                  <dd>{label(routine.engine)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Version</dt>
                  <dd>{routine.currentVersion ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>{label(routine.type)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <StatusBadge status={routine.status.toLowerCase()} />
                  </dd>
                </div>
              </dl>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Ownership</h2>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Agent</dt>
                  <dd>{routine.agent?.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Team</dt>
                  <dd>{routine.team?.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{formatDateTime(routine.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd>{formatDateTime(routine.updatedAt)}</dd>
                </div>
              </dl>
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Schedule</h2>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Schedule</dt>
                  <dd>{routine.schedule ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Last run</dt>
                  <dd>
                    {routine.lastRunAt
                      ? formatDateTime(routine.lastRunAt)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Next run</dt>
                  <dd>
                    {routine.nextRunAt
                      ? formatDateTime(routine.nextRunAt)
                      : "—"}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Triggers</h2>
            {routine.triggers.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {routine.triggers.map((trigger) => (
                  <div key={trigger.id} className="rounded border px-3 py-2">
                    <div className="text-sm font-medium">
                      {label(trigger.triggerType)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {trigger.enabled ? "Enabled" : "Disabled"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No triggers configured.
              </p>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
