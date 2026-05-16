import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Pause,
  Pencil,
  Play,
  Trash2,
  Zap,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSubscription, useQuery } from "urql";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PromptSection,
  RunDetailSheet,
  RunHistoryTable,
  type ScheduledJobRunRow,
} from "@thinkwork/ui";
import { Response } from "@/components/ai-elements/response";
import { useTenant } from "@/context/TenantContext";
import {
  MyComputerQuery,
  ThreadTurnUpdatedSubscription,
} from "@/lib/graphql-queries";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  ScheduledJobFormDialog,
  type ScheduledJobFormData,
} from "@/components/scheduled-jobs/ScheduledJobFormDialog";
import {
  JOB_TYPE_LABELS,
  formatSchedule,
  relativeTime,
  type ScheduledJobRow,
  type ThreadTurnRow,
} from "./-automations.utils";

export const Route = createFileRoute("/_authed/_shell/automations/$scheduledJobId")({
  component: ScheduledJobDetailPage,
});

interface MyComputerResult {
  myComputer: {
    id: string;
    name: string;
    tenantId: string;
    ownerUserId: string;
    sourceAgent: { id: string; name: string } | null;
  } | null;
}

async function apiFetch<T>(
  path: string,
  tenantId: string,
  options: RequestInit = {},
): Promise<T> {
  const { headers, ...rest } = options;
  return authedApiFetch<T>(path, {
    ...rest,
    extraHeaders: {
      "x-tenant-id": tenantId,
      ...(headers as Record<string, string> | undefined),
    },
  });
}


function ScheduledJobDetailPage() {
  const { scheduledJobId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();

  const [{ data: computerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
  });
  const computer = computerData?.myComputer ?? null;

  const [job, setJob] = useState<ScheduledJobRow | null>(null);
  const [jobLoading, setJobLoading] = useState(true);
  const [jobError, setJobError] = useState<string | null>(null);

  const [runs, setRuns] = useState<ThreadTurnRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "toggle" | "fire" | "delete" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<ScheduledJobRunRow | null>(null);
  const [runSheetOpen, setRunSheetOpen] = useState(false);

  const [subResult] = useSubscription({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const fetchJob = useCallback(async () => {
    if (!tenantId) return;
    try {
      const row = await apiFetch<ScheduledJobRow>(
        `/api/scheduled-jobs/${scheduledJobId}`,
        tenantId,
      );
      setJob(row);
      setJobError(null);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : String(err));
    } finally {
      setJobLoading(false);
    }
  }, [tenantId, scheduledJobId]);

  const fetchRuns = useCallback(async () => {
    if (!tenantId) return;
    try {
      const rows = await apiFetch<ThreadTurnRow[]>(
        `/api/thread-turns?limit=50&trigger_id=${encodeURIComponent(scheduledJobId)}`,
        tenantId,
      );
      setRuns(rows);
      setRunsError(null);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunsLoading(false);
    }
  }, [tenantId, scheduledJobId]);

  useEffect(() => {
    fetchJob();
    fetchRuns();
  }, [fetchJob, fetchRuns]);

  useEffect(() => {
    if (!subResult.data?.onThreadTurnUpdated) return;
    fetchRuns();
  }, [subResult.data, fetchRuns]);

  async function handleToggle() {
    if (!job || !tenantId) return;
    setPendingAction("toggle");
    setActionError(null);
    try {
      await apiFetch(`/api/scheduled-jobs/${job.id}`, tenantId, {
        method: "PUT",
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      await fetchJob();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleFire() {
    if (!job || !tenantId) return;
    setPendingAction("fire");
    setActionError(null);
    try {
      await apiFetch(`/api/scheduled-jobs/${job.id}/fire`, tenantId, {
        method: "POST",
      });
      // run history updates when ThreadTurnUpdatedSubscription fires
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete() {
    if (!job || !tenantId) return;
    setPendingAction("delete");
    setActionError(null);
    try {
      await apiFetch(`/api/scheduled-jobs/${job.id}`, tenantId, {
        method: "DELETE",
      });
      navigate({ to: "/automations" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setPendingAction(null);
    }
  }

  async function handleEditSubmit(data: ScheduledJobFormData) {
    if (!job || !tenantId) return;
    await apiFetch(`/api/scheduled-jobs/${job.id}`, tenantId, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    await fetchJob();
  }

  const headerSubtitle = job
    ? job.description
      ? job.description
      : `${formatSchedule(job.schedule_expression)} · ${job.timezone}`
    : undefined;

  usePageHeaderActions({
    title: job?.name ?? "Scheduled Job",
    subtitle: headerSubtitle,
    backHref: "/automations",
  });

  if (jobLoading || !tenantId) {
    return <PageSkeleton />;
  }

  if (jobError || !job) {
    return (
      <main className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="flex h-full min-h-0 flex-col gap-4 px-2 py-4 sm:px-4">
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-destructive">
                {jobError ?? "Scheduled job not found."}
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const sourceAgent = computer?.sourceAgent ?? null;

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="shrink-0 px-4 pt-4 pb-4 border-b border-border bg-background sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight leading-tight text-foreground">
              {job.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {job.description ||
                JOB_TYPE_LABELS[job.trigger_type] ||
                job.trigger_type}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pendingAction !== null || !sourceAgent}
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pendingAction !== null}
              onClick={handleToggle}
            >
              {pendingAction === "toggle" ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : job.enabled ? (
                <>
                  <Pause className="h-4 w-4 mr-1" /> Disable
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" /> Enable
                </>
              )}
            </Button>
            <Button
              size="sm"
              disabled={pendingAction !== null || !job.enabled}
              onClick={handleFire}
            >
              {pendingAction === "fire" ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-1" />
              )}
              Trigger Now
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pendingAction !== null}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this job?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {job.name} will stop firing and the EventBridge schedule
                    will be removed. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-6 sm:px-6 space-y-6">
        {actionError && (
          <p className="text-sm text-destructive">{actionError}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="gap-2 py-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <Badge variant="outline" className="capitalize">
                  {job.schedule_type || "—"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expression</span>
                <span className="font-mono text-xs">
                  {formatSchedule(job.schedule_expression)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timezone</span>
                <span>{job.timezone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                {job.enabled ? (
                  <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                    <Play className="h-3 w-3 fill-current" /> Active
                  </span>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Pause className="h-3 w-3" /> Disabled
                  </span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">EB Schedule</span>
                {job.eb_schedule_name ? (
                  <span className="font-mono text-xs text-green-600 dark:text-green-400">
                    {job.eb_schedule_name}
                  </span>
                ) : job.enabled && job.schedule_expression ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    Not provisioned
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No schedule
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-2 py-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Job Type</span>
                <Badge variant="secondary" className="text-xs">
                  {JOB_TYPE_LABELS[job.trigger_type] || job.trigger_type}
                </Badge>
              </div>
              {sourceAgent && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agent</span>
                  <Badge variant="outline" className="text-xs">
                    {sourceAgent.name}
                  </Badge>
                </div>
              )}
              {job.routine_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Routine</span>
                  <span className="font-mono text-xs">
                    {job.routine_id.slice(0, 8)}...
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Run</span>
                <span>
                  {job.last_run_at ? relativeTime(job.last_run_at) : "Never"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{relativeTime(job.created_at)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {job.prompt && <PromptSection prompt={job.prompt} />}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Run History</h2>
            <Button variant="outline" size="sm" onClick={fetchRuns}>
              Refresh
            </Button>
          </div>
          {runsLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading runs…</p>
          ) : runsError ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
              <p className="text-sm text-destructive">
                Failed to load run history: {runsError}
              </p>
              <Button size="sm" variant="ghost" onClick={fetchRuns}>
                Retry
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No runs yet.</p>
          ) : (
            <RunHistoryTable
              runs={runs as ScheduledJobRunRow[]}
              formatRelativeTime={relativeTime}
              onRowClick={(run) => {
                setSelectedRun(run);
                setRunSheetOpen(true);
              }}
            />
          )}
        </div>
      </div>

      <RunDetailSheet
        run={selectedRun}
        open={runSheetOpen}
        onOpenChange={(open) => {
          setRunSheetOpen(open);
          if (!open) setSelectedRun(null);
        }}
        renderResponse={(text) => <Response>{text}</Response>}
      />

      {sourceAgent && (
        <ScheduledJobFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          computerId={computer!.id}
          agentId={sourceAgent.id}
          initial={{
            name: job.name,
            schedule_type: job.schedule_type ?? "rate",
            schedule_expression: job.schedule_expression ?? "rate(5 minutes)",
            timezone: job.timezone,
            prompt: job.prompt ?? undefined,
          }}
          onSubmit={handleEditSubmit}
        />
      )}
    </main>
  );
}
