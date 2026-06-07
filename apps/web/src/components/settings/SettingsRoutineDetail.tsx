import { useCallback, useState } from "react";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { Zap } from "lucide-react";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  RoutineDetailQuery,
  TriggerRoutineRunMutation,
} from "@/lib/routine-queries";
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
import { LoadingShimmer } from "@/components/LoadingShimmer";

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SettingsRoutineDetail() {
  const { routineId } = useParams({
    from: "/_authed/settings/routines/$routineId",
  });
  const search = useSearch({
    from: "/_authed/settings/routines/$routineId",
  }) as { status?: StatusFilterId };
  const navigate = useNavigate();
  const statusFilter: StatusFilterId = parseStatusFilter(search.status);

  const [result, reexecuteRoutine] = useQuery({
    query: RoutineDetailQuery,
    variables: { id: routineId },
  });
  const [triggerState, executeTrigger] = useMutation(TriggerRoutineRunMutation);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [executionRefreshKey, setExecutionRefreshKey] = useState(0);
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

  const routine = result.data?.routine;

  const testDisabledReason = definitionState.saving
    ? "Wait for the workflow save to finish before testing."
    : definitionState.dirty
      ? "Save workflow changes before testing this version."
      : definitionState.invalid
        ? "Fix configuration issues before testing."
        : !definitionState.ready
          ? "Wait for the workflow definition to load before testing."
          : null;

  usePageHeaderActions({
    title: routine?.name ?? "Routine",
    breadcrumbs: [
      { label: "Routines", href: "/settings/routines" },
      { label: routine?.name ?? "Routine" },
    ],
    action: routine ? (
      <Button
        size="sm"
        variant="outline"
        onClick={handleRunNow}
        disabled={triggerState.fetching || testDisabledReason != null}
        title={testDisabledReason ?? undefined}
      >
        <Zap className="h-3.5 w-3.5" />
        {triggerState.fetching ? "Starting…" : "Test Routine"}
      </Button>
    ) : undefined,
    actionKey: `routine-test:${routineId}:${triggerState.fetching}:${testDisabledReason ?? "ok"}`,
  });

  async function handleRunNow() {
    if (testDisabledReason) return;
    setTriggerError(null);
    const res = await executeTrigger({ routineId, input: null });
    if (res.error) {
      setTriggerError(res.error.message.replace(/^\[GraphQL\]\s*/, ""));
      return;
    }
    if (res.data?.triggerRoutineRun) {
      setExecutionRefreshKey((key) => key + 1);
    }
  }

  if (result.fetching && !routine) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (!routine) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          This routine could not be loaded — it may have been removed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-6">
      {triggerError && (
        <p className="mb-3 shrink-0 text-sm text-destructive">{triggerError}</p>
      )}
      <Tabs
        defaultValue="workflow"
        className="flex h-full min-h-0 flex-col gap-4"
      >
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
            Details
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="workflow"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <RoutineDefinitionPanel
            routineId={routineId}
            onPublished={() =>
              reexecuteRoutine({ requestPolicy: "network-only" })
            }
            onStateChange={handleDefinitionStateChange}
            layout="workspace"
          />
        </TabsContent>

        <TabsContent
          value="activity"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <ExecutionList
            routineId={routineId}
            statusFilter={statusFilter}
            onStatusFilterChange={(next) =>
              navigate({
                to: "/settings/routines/$routineId",
                params: { routineId },
                search: next === "all" ? {} : { status: next },
                replace: true,
              })
            }
            refreshKey={executionRefreshKey}
          />
        </TabsContent>

        <TabsContent
          value="config"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto"
        >
          <section className="space-y-2 rounded-md border border-border/70 p-4">
            <h2 className="text-sm font-semibold">Description</h2>
            <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
              {routine.description ?? "No description provided."}
            </p>
          </section>
          <section className="space-y-3 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Definition</h2>
            <dl className="grid max-w-md gap-2 text-sm">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
