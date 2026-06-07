import { Pause, Pencil, Play, Trash2, Zap, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useSubscription } from "urql";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type ScheduledJobRunRow,
} from "@thinkwork/ui";
import { Response } from "@/components/ai-elements/response";
import { useTenant } from "@/context/TenantContext";
import { ThreadTurnUpdatedSubscription } from "@/lib/graphql-queries";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import {
  ScheduledJobForm,
  type ScheduledJobFormData,
} from "@/components/scheduled-jobs/ScheduledJobForm";
import {
  JOB_TYPE_LABELS,
  formatSchedule,
  relativeTime,
  type ScheduledJobRow,
  type ThreadTurnRow,
} from "@/routes/_authed/_shell/-automations.utils";

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

/**
 * Scheduled-job (automation) detail, shared between the main-nav Automations
 * shell and the Settings → Automations shell. The hosting route supplies the
 * job id, the back/breadcrumb target, and the post-delete navigation so the
 * view stays within whichever shell opened it. The edit agent is the tenant
 * platform agent (the per-Computer source agent was removed with the Computer
 * concept).
 */
export function ScheduledJobDetail({
  scheduledJobId,
  backHref,
  onDeleted,
}: {
  scheduledJobId: string;
  backHref: string;
  onDeleted: () => void;
}) {
  const { tenantId } = useTenant();

  const [agentResult] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const agentId = agentResult.data?.agent?.id ?? null;

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
  const [selectedRun, setSelectedRun] = useState<ScheduledJobRunRow | null>(
    null,
  );
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
      onDeleted();
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

  // Row actions live as icon buttons in the page header (matching the other
  // settings detail pages), not as an in-body toolbar.
  const toggleLabel = job?.enabled ? "Disable" : "Enable";
  const headerActions = job ? (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit"
                disabled={pendingAction !== null || !agentId}
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Edit</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={toggleLabel}
                disabled={pendingAction !== null}
                onClick={handleToggle}
              >
                {pendingAction === "toggle" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : job.enabled ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Trigger now"
                disabled={pendingAction !== null || !job.enabled}
                onClick={handleFire}
              >
                {pendingAction === "fire" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Zap className="size-4" />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {job.enabled ? "Trigger now" : "Enable to trigger"}
          </TooltipContent>
        </Tooltip>
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    className="text-destructive hover:text-destructive"
                    disabled={pendingAction !== null}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </AlertDialogTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this job?</AlertDialogTitle>
              <AlertDialogDescription>
                {job.name} will stop firing and the EventBridge schedule will be
                removed. This cannot be undone.
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
    </TooltipProvider>
  ) : undefined;

  usePageHeaderActions({
    title: job?.name ?? "Scheduled Job",
    subtitle: headerSubtitle,
    backHref,
    breadcrumbs: [
      { label: "Automations", href: backHref },
      { label: job?.name ?? "Scheduled Job" },
    ],
    action: headerActions,
    actionKey: job ? `job-actions:${job.id}` : undefined,
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

  // Full-page edit replaces the read view (no modal). agentId is required to
  // fire the job; the Edit button is disabled until it resolves.
  if (editOpen && agentId) {
    return (
      <main className="h-full w-full overflow-y-auto bg-background">
        <ScheduledJobForm
          mode="edit"
          agentId={agentId}
          initial={{
            name: job.name,
            schedule_type: job.schedule_type ?? "rate",
            schedule_expression: job.schedule_expression ?? "rate(5 minutes)",
            timezone: job.timezone,
            prompt: job.prompt ?? undefined,
          }}
          onSubmit={async (data) => {
            await handleEditSubmit(data);
            setEditOpen(false);
          }}
          onCancel={() => setEditOpen(false)}
        />
      </main>
    );
  }

  return (
    <main className="h-full w-full overflow-y-auto bg-background">
      <div className="w-full space-y-6 px-4 py-6 sm:px-6">
        <SettingsPageTitle
          title={job.name}
          badge={
            <Badge variant={job.enabled ? "secondary" : "outline"}>
              {job.enabled ? "Enabled" : "Disabled"}
            </Badge>
          }
        />
        {actionError && (
          <p className="text-sm text-destructive">{actionError}</p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                    <Play className="h-3 w-3 fill-current" /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground">
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
            <p className="py-4 text-sm text-muted-foreground">Loading runs…</p>
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
            <p className="py-4 text-sm text-muted-foreground">No runs yet.</p>
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
    </main>
  );
}
