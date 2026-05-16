import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Play, Pause, Zap, Trash2, Loader2, Pencil } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useSubscription } from "urql";
import {
  PromptSection,
  RunDetailSheet,
  RunHistoryTable,
  type ScheduledJobRunRow,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { OnThreadTurnUpdatedSubscription } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScheduledJobFormDialog } from "@/components/scheduled-jobs/ScheduledJobFormDialog";
import { relativeTime } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";

export const Route = createFileRoute("/_authed/_tenant/automations/schedules/$scheduledJobId")({
  component: ScheduledJobDetailPage,
});

type ScheduledJob = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  enabled: boolean;
  schedule_type: string | null;
  schedule_expression: string | null;
  timezone: string;
  agent_id: string | null;
  routine_id: string | null;
  prompt: string | null;
  config: Record<string, unknown> | null;
  eb_schedule_name: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

type RunRow = ScheduledJobRunRow;

async function apiFetch<T>(path: string, tenantId: string, options: RequestInit = {}): Promise<T> {
  const { headers, ...rest } = options;
  return authedApiFetch<T>(path, {
    ...rest,
    extraHeaders: { "x-tenant-id": tenantId, ...(headers as Record<string, string> | undefined) },
  });
}

const TYPE_LABELS: Record<string, string> = {
  agent_heartbeat: "Agent Heartbeat",
  agent_reminder: "Agent Reminder",
  agent_scheduled: "Agent Scheduled",
  routine_schedule: "Routine Schedule",
  routine_one_time: "Routine One-time",
};

function formatSchedule(expr: string | null): string {
  if (!expr) return "—";
  if (expr.startsWith("rate(")) return expr.slice(5, -1);
  if (expr.startsWith("at(")) {
    try { return new Date(expr.slice(3, -1)).toLocaleString(); } catch { return expr; }
  }
  return expr;
}

// ---------------------------------------------------------------------------
// Prompt panel — collapsed to ~5 lines by default with a Show all toggle.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Edit Scheduled Job (uses shared dialog)
// ---------------------------------------------------------------------------

function EditScheduledJobButton({ scheduledJob, tenantId, onSaved }: { scheduledJob: ScheduledJob; tenantId: string; onSaved: (t: ScheduledJob) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4 mr-1" /> Edit
      </Button>
      <ScheduledJobFormDialog
        open={open}
        onOpenChange={setOpen}
        mode="edit"
        tenantId={tenantId}
        initial={{
          name: scheduledJob.name,
          trigger_type: scheduledJob.trigger_type,
          agent_id: scheduledJob.agent_id || undefined,
          prompt: scheduledJob.prompt || undefined,
          config: scheduledJob.config || undefined,
          schedule_type: scheduledJob.schedule_type || "rate",
          schedule_expression: scheduledJob.schedule_expression || "",
          timezone: scheduledJob.timezone,
        }}
        onSubmit={async (data) => {
          const updated = await apiFetch<ScheduledJob>(`/api/scheduled-jobs/${scheduledJob.id}`, tenantId, {
            method: "PUT",
            body: JSON.stringify(data),
          });
          onSaved(updated);
        }}
      />
    </>
  );
}


function ScheduledJobDetailPage() {
  const { scheduledJobId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [job, setJob] = useState<ScheduledJob | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunRow | null>(null);
  const [runSheetOpen, setRunSheetOpen] = useState(false);

  useBreadcrumbs([
    { label: "Automations", href: "/automations/schedules" },
    { label: job?.name || "..." },
  ]);

  // Live subscription — refetch runs when any scheduled job run updates for this tenant
  const [subResult] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const jobData = await apiFetch<ScheduledJob>(`/api/scheduled-jobs/${scheduledJobId}`, tenantId);
      const runsData = await apiFetch<RunRow[]>(`/api/thread-turns?trigger_id=${scheduledJobId}&limit=50`, tenantId);
      setJob(jobData);
      setRuns(runsData);
      setError(null);

      if (jobData.agent_id) {
        try {
          const agent = await apiFetch<{ name: string }>(`/api/agents/${jobData.agent_id}`, tenantId);
          setAgentName(agent.name);
        } catch {
          setAgentName(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, scheduledJobId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Refetch when subscription delivers a run update for this scheduled job
  useEffect(() => {
    const event = subResult.data?.onThreadTurnUpdated;
    if (!event) return;
    if (event.triggerId && event.triggerId !== scheduledJobId) return;
    fetchData();
  }, [subResult.data, scheduledJobId, fetchData]);

  async function handleToggle() {
    if (!tenantId || !job) return;
    setToggling(true);
    try {
      const updated = await apiFetch<ScheduledJob>(`/api/scheduled-jobs/${scheduledJobId}`, tenantId, {
        method: "PUT",
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      setJob(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  }

  async function handleTrigger() {
    if (!tenantId) return;
    setTriggering(true);
    try {
      await apiFetch(`/api/scheduled-jobs/${scheduledJobId}/fire`, tenantId, { method: "POST" });
      setTimeout(fetchData, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriggering(false);
    }
  }

  async function handleDelete() {
    if (!tenantId) return;
    try {
      await apiFetch(`/api/scheduled-jobs/${scheduledJobId}`, tenantId, { method: "DELETE" });
      navigate({ to: "/automations/schedules" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!tenantId || loading) return <PageSkeleton />;
  if (!job) return <div className="p-6 text-destructive">Scheduled job not found</div>;

  return (
    <div className="flex flex-col -m-6" style={{ height: "calc(100% + 48px)" }}>
      {/* Fixed header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border bg-background">
        <PageHeader
          title={job.name}
          description={job.description || TYPE_LABELS[job.trigger_type] || job.trigger_type}
          actions={
            <div className="flex items-center gap-2">
              <EditScheduledJobButton scheduledJob={job} tenantId={tenantId} onSaved={setJob} />
              <Button variant="outline" size="sm" onClick={handleToggle} disabled={toggling}>
                {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : job.enabled ? <><Pause className="h-4 w-4 mr-1" /> Disable</> : <><Play className="h-4 w-4 mr-1" /> Enable</>}
              </Button>
              {job.agent_id && (
                <Button size="sm" onClick={handleTrigger} disabled={triggering}>
                  {triggering ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />} Trigger Now
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm"><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete scheduled job?</AlertDialogTitle>
                    <AlertDialogDescription>This will disable the scheduled job and remove its EventBridge schedule. Run history will be preserved.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          }
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 min-h-0">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="gap-2 py-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <Badge variant="outline" className="capitalize">{job.schedule_type || "—"}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expression</span>
                <span className="font-mono text-xs">{formatSchedule(job.schedule_expression)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timezone</span>
                <span>{job.timezone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                {job.enabled ? (
                  <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><Play className="h-3 w-3 fill-current" /> Active</span>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1"><Pause className="h-3 w-3" /> Disabled</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">EB Schedule</span>
                {job.eb_schedule_name ? (
                  <span className="font-mono text-xs text-green-600 dark:text-green-400">{job.eb_schedule_name}</span>
                ) : job.enabled && job.schedule_expression ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">Not provisioned</span>
                ) : (
                  <span className="text-xs text-muted-foreground">No schedule</span>
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
                <Badge variant="secondary" className="text-xs">{TYPE_LABELS[job.trigger_type] || job.trigger_type}</Badge>
              </div>
              {job.agent_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agent</span>
                  <Badge variant="outline" className="text-xs">{agentName ?? job.agent_id.slice(0, 8) + "..."}</Badge>
                </div>
              )}
              {job.routine_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Routine</span>
                  <span className="font-mono text-xs">{job.routine_id.slice(0, 8)}...</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Run</span>
                <span>{job.last_run_at ? relativeTime(job.last_run_at) : "Never"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{relativeTime(job.created_at)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {job.prompt && <PromptSection prompt={job.prompt} />}

        {job.config && Object.keys(job.config).length > 0 && (
          <Card className="gap-2 py-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Config</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3 font-mono">
                {JSON.stringify(job.config, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Run History</h2>
            <Button variant="outline" size="sm" onClick={fetchData}>Refresh</Button>
          </div>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No runs yet.</p>
          ) : (
            <RunHistoryTable
              runs={runs}
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
        renderResponse={(text) => (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        )}
      />
    </div>
  );
}
