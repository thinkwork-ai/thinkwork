import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Play, Pause, Zap, Trash2, Loader2, Pencil } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { useTenant } from "@/context/TenantContext";
import { AgentDetailQuery, OnThreadTurnUpdatedSubscription } from "@/lib/graphql-queries";
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
import { DataTable } from "@/components/ui/data-table";
import { FilterBarSort } from "@/components/ui/data-table-filter-bar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, relativeTime } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId_/scheduled-jobs/$scheduledJobId")({
  component: AgentScheduledJobDetailPage,
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

type RunRow = {
  id: string;
  invocation_source: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result_json: Record<string, unknown> | null;
  usage_json: Record<string, unknown> | null;
  created_at: string;
};

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

const RUN_STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  succeeded: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

function formatSchedule(expr: string | null): string {
  if (!expr) return "—";
  if (expr.startsWith("rate(")) return expr.slice(5, -1);
  if (expr.startsWith("at(")) {
    try { return new Date(expr.slice(3, -1)).toLocaleString(); } catch { return expr; }
  }
  return expr;
}

const runColumns: ColumnDef<RunRow>[] = [
  {
    accessorKey: "status",
    header: "Status",
    enableSorting: false,
    cell: ({ row }) => (
      <Badge variant="secondary" className={cn("text-xs capitalize", RUN_STATUS_COLORS[row.original.status] ?? "")}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "invocation_source",
    header: "Source",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-sm capitalize">{row.original.invocation_source.replace(/_/g, " ")}</span>
    ),
  },
  {
    accessorKey: "started_at",
    header: "Started",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.started_at ? relativeTime(row.original.started_at) : "Queued"}
      </span>
    ),
  },
  {
    id: "duration",
    accessorFn: (row) => (row.usage_json?.duration_ms as number) ?? 0,
    header: "Duration",
    enableSorting: false,
    cell: ({ row }) => {
      const ms = row.original.usage_json?.duration_ms as number | undefined;
      return ms != null ? <span className="text-xs text-muted-foreground">{(ms / 1000).toFixed(1)}s</span> : null;
    },
  },
];

function RunDetailDialog({ run, open, onOpenChange }: {
  run: RunRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!run) return null;
  const rawResponse = (run.result_json?.response ?? run.result_json?.result) as string | undefined;
  const responseText = rawResponse?.replace(/```[\w]*\n?/g, "");
  const durationMs = run.usage_json?.duration_ms as number | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[75vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Run Details
            <Badge variant="secondary" className={cn("text-xs capitalize", RUN_STATUS_COLORS[run.status] ?? "")}>
              {run.status}
            </Badge>
            {durationMs != null && (
              <span className="text-xs text-muted-foreground">{(durationMs / 1000).toFixed(1)}s</span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-muted-foreground">Source</span><p className="capitalize">{run.invocation_source.replace(/_/g, " ")}</p></div>
            <div><span className="text-muted-foreground">Started</span><p>{run.started_at ? new Date(run.started_at).toLocaleString() : "Queued"}</p></div>
            <div><span className="text-muted-foreground">Finished</span><p>{run.finished_at ? new Date(run.finished_at).toLocaleString() : "..."}</p></div>
          </div>
          {responseText && (
            <div>
              <span className="text-muted-foreground text-xs">Response</span>
              <div className="mt-1 bg-muted/50 rounded-md p-3 text-sm prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{responseText}</ReactMarkdown>
              </div>
            </div>
          )}
          {run.error && (
            <div>
              <span className="text-muted-foreground text-xs">Error</span>
              <pre className="mt-1 whitespace-pre-wrap text-destructive bg-destructive/5 rounded-md p-3 text-sm">{run.error}</pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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

function AgentScheduledJobDetailPage() {
  const { agentId, scheduledJobId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [job, setJob] = useState<ScheduledJob | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [viewingRun, setViewingRun] = useState<RunRow | null>(null);
  const [sortField, setSortField] = useState("started_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Fetch agent name for breadcrumbs
  const [agentResult] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });
  const agentName = agentResult.data?.agent?.name;

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: agentName ?? "...", href: `/agents/${agentId}` },
    { label: "Automations", href: `/agents/${agentId}/scheduled-jobs` },
    { label: job?.name ?? "..." },
  ]);

  const [subResult] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const jobData = await apiFetch<ScheduledJob>(`/api/scheduled-jobs/${scheduledJobId}`, tenantId);
      setJob(jobData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    try {
      const runsData = await apiFetch<RunRow[]>(`/api/thread-turns?trigger_id=${scheduledJobId}&limit=50`, tenantId);
      setRuns(runsData);
    } catch {
      // runs are supplementary
    }
    setLoading(false);
  }, [tenantId, scheduledJobId]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      navigate({ to: "/agents/$agentId/scheduled-jobs", params: { agentId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const sortedRuns = useMemo(() => {
    const sorted = [...runs];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortField === "started_at") {
        cmp = (a.started_at ?? "").localeCompare(b.started_at ?? "");
      } else if (sortField === "status") {
        cmp = a.status.localeCompare(b.status);
      } else if (sortField === "source") {
        cmp = a.invocation_source.localeCompare(b.invocation_source);
      } else if (sortField === "duration") {
        const ams = (a.usage_json?.duration_ms as number) ?? 0;
        const bms = (b.usage_json?.duration_ms as number) ?? 0;
        cmp = ams - bms;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [runs, sortField, sortDir]);

  if (!tenantId || loading) return <PageSkeleton />;
  if (!job) return <div className="p-6 text-destructive">Scheduled job not found</div>;

  return (
    <div className="flex flex-col -m-6" style={{ height: "calc(100% + 48px)" }}>
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border bg-background">
        <PageHeader
          title={job.name}
          description={job.description || TYPE_LABELS[job.trigger_type] || job.trigger_type}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate({ to: "/agents/$agentId/scheduled-jobs", params: { agentId } })}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <EditScheduledJobButton scheduledJob={job} tenantId={tenantId} onSaved={setJob} />
              <Button variant="outline" size="sm" onClick={handleToggle} disabled={toggling}>
                {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : job.enabled ? <><Pause className="h-4 w-4 mr-1" /> Disable</> : <><Play className="h-4 w-4 mr-1" /> Enable</>}
              </Button>
              {(job.agent_id || job.trigger_type === "eval_scheduled") && (
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
              {agentName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agent</span>
                  <Badge variant="outline" className="text-xs">{agentName}</Badge>
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

        {job.prompt && (
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">Prompt</h3>
            <Card className="py-3">
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap font-mono">{job.prompt}</pre>
              </CardContent>
            </Card>
          </div>
        )}

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
            <h2 className="text-sm font-semibold">Run History</h2>
            <div className="flex items-center gap-1">
              <FilterBarSort
                options={[
                  { value: "started_at", label: "Time" },
                  { value: "status", label: "Status" },
                  { value: "source", label: "Source" },
                  { value: "duration", label: "Duration" },
                ]}
                field={sortField}
                direction={sortDir}
                onChange={(field, dir) => { setSortField(field); setSortDir(dir); }}
              />
              <button type="button" onClick={fetchData} className="text-xs text-muted-foreground hover:text-foreground ml-2">
                Refresh
              </button>
            </div>
          </div>
          {sortedRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No runs yet.</p>
          ) : (
            <DataTable
              columns={runColumns}
              data={sortedRuns}
              onRowClick={(row) => setViewingRun(row)}
            />
          )}
        </div>

        <RunDetailDialog
          run={viewingRun}
          open={!!viewingRun}
          onOpenChange={(open) => { if (!open) setViewingRun(null); }}
        />
      </div>
    </div>
  );
}
