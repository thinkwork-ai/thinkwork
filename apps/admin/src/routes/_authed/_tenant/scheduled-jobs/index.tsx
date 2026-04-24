import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Play, Pause, Bot, Repeat, Clock, CalendarClock, Plus, Loader2 } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useSubscription, useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { OnThreadTurnUpdatedSubscription, AgentsListQuery } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScheduledJobFormDialog } from "@/components/scheduled-jobs/ScheduledJobFormDialog";
import { relativeTime } from "@/lib/utils";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";

export const Route = createFileRoute("/_authed/_tenant/scheduled-jobs/")({
  component: ScheduledJobsPage,
  validateSearch: (search: Record<string, unknown>): { type?: string; agentId?: string } => ({
    ...(search.type ? { type: search.type as string } : {}),
    ...(search.agentId ? { agentId: search.agentId as string } : {}),
  }),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScheduledJobRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  enabled: boolean;
  schedule_type: string;
  schedule_expression: string | null;
  timezone: string;
  agent_id: string | null;
  routine_id: string | null;
  prompt: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

type ThreadTurnRow = {
  id: string;
  job_id: string | null;
  trigger_id: string | null;
  agent_id: string | null;
  routine_id: string | null;
  invocation_source: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result_json: Record<string, unknown> | null;
  usage_json: Record<string, unknown> | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, tenantId: string, options: RequestInit = {}): Promise<T> {
  const { headers, ...rest } = options;
  return authedApiFetch<T>(path, {
    ...rest,
    extraHeaders: { "x-tenant-id": tenantId, ...(headers as Record<string, string> | undefined) },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JOB_TYPE_LABELS: Record<string, string> = {
  agent_heartbeat: "Heartbeat",
  agent_reminder: "Reminder",
  agent_scheduled: "Scheduled",
  routine_schedule: "Routine",
  routine_one_time: "One-time",
};

const JOB_TYPE_COLORS: Record<string, string> = {
  agent_heartbeat: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  agent_reminder: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  agent_scheduled: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  routine_schedule: "bg-green-500/15 text-green-600 dark:text-green-400",
  routine_one_time: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
};

function jobTypeIcon(type: string) {
  if (type.startsWith("agent_")) return <Bot className="h-3.5 w-3.5" />;
  return <Repeat className="h-3.5 w-3.5" />;
}

function formatSchedule(expr: string | null): string {
  if (!expr) return "—";
  if (expr.startsWith("rate(")) return expr.slice(5, -1);
  if (expr.startsWith("at(")) {
    const dt = expr.slice(3, -1);
    try { return new Date(dt).toLocaleString(); } catch { return dt; }
  }
  return expr;
}

/** Estimate next run from schedule expression + last run. Returns null if can't compute. */
function estimateNextRun(scheduleExpr: string | null, lastRunAt: string | null): Date | null {
  if (!scheduleExpr) return null;

  // at(...) — one-time schedule
  if (scheduleExpr.startsWith("at(")) {
    const dt = scheduleExpr.slice(3, -1);
    try {
      const d = new Date(dt);
      return d > new Date() ? d : null;
    } catch { return null; }
  }

  // rate(...) — e.g. rate(5 minutes), rate(1 hour)
  if (scheduleExpr.startsWith("rate(")) {
    const inner = scheduleExpr.slice(5, -1).trim(); // "5 minutes"
    const match = inner.match(/^(\d+)\s+(minute|hour|day|second)s?$/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const ms = value * (unit === "second" ? 1000 : unit === "minute" ? 60000 : unit === "hour" ? 3600000 : 86400000);
    const base = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
    const next = new Date(base + ms);
    // If computed next is in the past (stale last_run_at), step forward
    if (next.getTime() < Date.now()) {
      const elapsed = Date.now() - base;
      const periods = Math.ceil(elapsed / ms);
      return new Date(base + periods * ms);
    }
    return next;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Columns — Jobs
// ---------------------------------------------------------------------------

function ownerLabel(job: ScheduledJobRow, agentNames: Map<string, string>): { icon: React.ReactNode; label: string; color: string } {
  if (job.trigger_type.startsWith("routine_")) {
    return { icon: <Repeat className="h-3.5 w-3.5" />, label: "Routine", color: "bg-green-500/15 text-green-600 dark:text-green-400" };
  }
  // Agent jobs — show agent name
  const name = job.agent_id ? agentNames.get(job.agent_id) : null;
  return { icon: <Bot className="h-3.5 w-3.5" />, label: name || "Agent", color: "bg-purple-500/15 text-purple-600 dark:text-purple-400" };
}

function jobColumns(runningIds: Set<string>, agentNames: Map<string, string>): ColumnDef<ScheduledJobRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description && (
            <span className="text-xs text-muted-foreground line-clamp-1">{row.original.description}</span>
          )}
        </div>
      ),
    },
    {
      id: "owner",
      header: "Type",
      cell: ({ row }) => {
        const owner = ownerLabel(row.original, agentNames);
        return (
          <Badge variant="secondary" className={`text-xs gap-1 ${owner.color}`}>
            {owner.icon}
            {owner.label}
          </Badge>
        );
      },
      size: 160,
    },
    {
      accessorKey: "schedule_expression",
      header: "Schedule",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs">{formatSchedule(row.original.schedule_expression)}</span>
        </div>
      ),
      size: 180,
    },
    {
      accessorKey: "enabled",
      header: "Status",
      cell: ({ row }) => {
        const isRunning = runningIds.has(row.original.id);
        if (!row.original.enabled) {
          return (
            <Badge variant="secondary" className="text-xs gap-1 bg-muted text-muted-foreground">
              <Pause className="h-3 w-3" /> Disabled
            </Badge>
          );
        }
        if (isRunning) {
          return (
            <Badge variant="secondary" className="text-xs gap-1 bg-blue-500/15 text-blue-600 dark:text-blue-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Running
            </Badge>
          );
        }
        return (
          <Badge variant="secondary" className="text-xs gap-1 bg-green-500/15 text-green-600 dark:text-green-400">
            <Play className="h-3 w-3 fill-current" /> Idle
          </Badge>
        );
      },
      size: 110,
    },
    {
      accessorKey: "last_run_at",
      header: "Last Run",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.last_run_at ? relativeTime(row.original.last_run_at) : "Never"}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: "next_run_at",
      header: "Next Run",
      cell: ({ row }) => {
        if (!row.original.enabled) return <span className="text-xs text-muted-foreground">—</span>;
        const nextDb = row.original.next_run_at;
        const estimated = estimateNextRun(row.original.schedule_expression, row.original.last_run_at);
        const nextDate = nextDb ? new Date(nextDb) : estimated;
        if (!nextDate) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className="text-xs text-muted-foreground">
            {relativeTime(nextDate.toISOString())}
          </span>
        );
      },
      size: 120,
    },
  ];
}

// ---------------------------------------------------------------------------
// Create Scheduled Job — context-aware button
// ---------------------------------------------------------------------------

function CreateScheduledJobButton({
  tenantId,
  filterType,
  onCreated,
}: {
  tenantId: string;
  filterType?: string;
  onCreated: () => void;
}) {
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAgentDialogOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Add Job
      </Button>
      <ScheduledJobFormDialog
        open={agentDialogOpen}
        onOpenChange={setAgentDialogOpen}
        mode="create"
        tenantId={tenantId}
        onSubmit={async (data) => {
          await apiFetch("/api/scheduled-jobs", tenantId, {
            method: "POST",
            body: JSON.stringify(data),
          });
          onCreated();
        }}
      />
    </>
  );
}


// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ScheduledJobsPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { type, agentId } = Route.useSearch();
  const [search, setSearch] = useState("");
  const [jobs, setJobs] = useState<ScheduledJobRow[]>([]);
  const [runs, setRuns] = useState<ThreadTurnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch agents for name resolution in Type column + breadcrumbs
  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of (agentsResult.data?.agents ?? []) as { id: string; name: string }[]) {
      map.set(a.id, a.name);
    }
    return map;
  }, [agentsResult.data]);

  const filterTitle = type === "agent" ? "Schedules: Agents"
    : type === "routine" ? "Schedules: Routines"
    : "Automations";

  const agentName = agentId ? agentNames.get(agentId) : null;

  const breadcrumbs = useMemo(() => {
    if (type === "agent" && agentId) {
      return [
        { label: "Agents", href: "/agents" },
        { label: agentName ?? "...", href: `/agents/${agentId}` },
        { label: "Automations" },
      ];
    }
    if (type === "routine") {
      return [
        { label: "Routines", href: "/routines" },
        { label: "Automations" },
      ];
    }
    return [{ label: "Automations" }];
  }, [type, agentId, agentName]);

  useBreadcrumbs(breadcrumbs);

  // Live subscription — refetch when scheduled job runs change
  const [subResult] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [jobsData, runsData] = await Promise.all([
        apiFetch<ScheduledJobRow[]>("/api/scheduled-jobs", tenantId),
        apiFetch<ThreadTurnRow[]>("/api/thread-turns?limit=100", tenantId),
      ]);
      setJobs(jobsData);
      setRuns(runsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Refetch when subscription delivers a run update
  useEffect(() => {
    if (!subResult.data?.onThreadTurnUpdated) return;
    fetchData();
  }, [subResult.data, fetchData]);

  // Derive which scheduled jobs currently have running runs
  const runningJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of runs) {
      if ((r.status === "running" || r.status === "queued") && r.job_id) {
        ids.add(r.job_id);
      }
    }
    return ids;
  }, [runs]);

  // Apply contextual filtering based on search params
  const contextJobs = useMemo(() => {
    let filtered = jobs;
    if (type === "agent") filtered = filtered.filter((j) => j.trigger_type.startsWith("agent_"));
    else if (type === "routine") filtered = filtered.filter((j) => j.trigger_type.startsWith("routine_"));
    if (agentId) filtered = filtered.filter((j) => j.agent_id === agentId);
    return filtered;
  }, [jobs, type, agentId]);

  const enabledJobs = useMemo(() => contextJobs.filter((j) => j.enabled), [contextJobs]);
  const disabledJobs = useMemo(() => contextJobs.filter((j) => !j.enabled), [contextJobs]);

  const filteredJobs = useMemo(() => {
    if (!search) return contextJobs;
    const q = search.toLowerCase();
    return contextJobs.filter(
      (j) =>
        j.name.toLowerCase().includes(q) ||
        j.trigger_type.toLowerCase().includes(q) ||
        (j.description?.toLowerCase().includes(q) ?? false),
    );
  }, [contextJobs, search]);

  if (!tenantId || loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)]">
      {/* Header — fixed */}
      <div className="shrink-0 space-y-4 pb-4">
        <PageHeader
          title={filterTitle}
          description={`${enabledJobs.length} active, ${disabledJobs.length} disabled`}
          actions={
            <CreateScheduledJobButton tenantId={tenantId} filterType={type} onCreated={fetchData} />
          }
        >
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search jobs..." className="pl-9" />
            </div>
            <Select
              value={type || "all"}
              onValueChange={(v) => navigate({ to: "/scheduled-jobs", search: v === "all" ? {} : { type: v } })}
            >
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="routine">Routine</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PageHeader>
      </div>

      {/* Table — scrollable body, fixed pagination */}
      <div className="flex-1 min-h-0">
        <DataTable
          columns={jobColumns(runningJobIds, agentNames)}
          data={filteredJobs}
          filterValue={search}
          filterColumn="name"
          scrollable
          onRowClick={(row) => navigate({ to: "/scheduled-jobs/$scheduledJobId", params: { scheduledJobId: row.id } })}
        />
      </div>
    </div>
  );
}
