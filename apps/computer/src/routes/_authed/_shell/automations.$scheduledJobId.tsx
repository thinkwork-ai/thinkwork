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
} from "@thinkwork/ui";
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

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "succeeded"
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : status === "failed"
        ? "bg-destructive/15 text-destructive"
        : status === "running" || status === "queued"
          ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
          : "bg-muted text-muted-foreground";
  return (
    <Badge variant="secondary" className={`text-xs gap-1 ${tone}`}>
      {status}
    </Badge>
  );
}

function RunRowCard({ run }: { run: ThreadTurnRow }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="text-xs text-muted-foreground">
          {run.started_at ? relativeTime(run.started_at) : "—"}
        </span>
      </div>
      {run.error ? (
        <span className="text-xs text-destructive line-clamp-1 max-w-md">
          {run.error}
        </span>
      ) : null}
    </div>
  );
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
      <div className="flex h-full min-h-0 flex-col gap-4 px-2 py-4 sm:px-4">
        <header className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={pendingAction !== null}
            onClick={handleToggle}
          >
            {pendingAction === "toggle" ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : job.enabled ? (
              <Pause className="h-4 w-4 mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            {job.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={pendingAction !== null || !sourceAgent}
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={pendingAction !== null || !job.enabled}
            onClick={handleFire}
          >
            {pendingAction === "fire" ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            Fire Now
          </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
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
        </header>
        {actionError && (
          <p className="shrink-0 text-sm text-destructive">{actionError}</p>
        )}

        <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            <Badge
              variant="secondary"
              className={`text-xs gap-1 ${job.enabled ? "bg-green-500/15 text-green-600" : "bg-muted text-muted-foreground"}`}
            >
              {job.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <div>
            <span className="text-muted-foreground">Schedule:</span>{" "}
            {formatSchedule(job.schedule_expression)} · {job.timezone}
          </div>
          {job.prompt && (
            <div className="space-y-1">
              <span className="text-muted-foreground">Prompt:</span>
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                {job.prompt}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runsLoading ? (
            <p className="text-sm text-muted-foreground">Loading runs…</p>
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
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            runs.map((run) => <RunRowCard key={run.id} run={run} />)
          )}
        </CardContent>
      </Card>

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
      </div>
    </main>
  );
}
