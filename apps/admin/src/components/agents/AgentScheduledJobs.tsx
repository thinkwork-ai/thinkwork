import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Bot, Clock, Loader2, Pause, Play, Repeat } from "lucide-react";
import { useSubscription } from "urql";
import { useTenant } from "@/context/TenantContext";
import { OnThreadTurnUpdatedSubscription } from "@/lib/graphql-queries";
import { DataTable } from "@/components/ui/data-table";

import { Badge } from "@/components/ui/badge";
import { ScheduledJobFormDialog, type ScheduledJobFormData } from "@/components/scheduled-jobs/ScheduledJobFormDialog";
import { relativeTime } from "@/lib/utils";

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

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
  schedule_expression: string;
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
  status: string;
};

// ---------------------------------------------------------------------------
// REST helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, tenantId: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
      "x-tenant-id": tenantId,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
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

function formatSchedule(expr: string): string {
  if (expr.startsWith("rate(")) return expr.slice(5, -1);
  if (expr.startsWith("at(")) {
    const dt = expr.slice(3, -1);
    try { return new Date(dt).toLocaleString(); } catch { return dt; }
  }
  return expr;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function scheduledJobColumns(runningIds: Set<string>): ColumnDef<ScheduledJobRow>[] {
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
      accessorKey: "trigger_type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="secondary" className={`text-xs gap-1 ${JOB_TYPE_COLORS[row.original.trigger_type] || ""}`}>
          {jobTypeIcon(row.original.trigger_type)}
          {JOB_TYPE_LABELS[row.original.trigger_type] || row.original.trigger_type}
        </Badge>
      ),
      size: 130,
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
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AgentScheduledJobsProps {
  agentId: string;
}

export function AgentScheduledJobs({ agentId }: AgentScheduledJobsProps) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJobRow[]>([]);
  const [runs, setRuns] = useState<ThreadTurnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  // Live subscription
  const [subResult] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const allJobs = await apiFetch<ScheduledJobRow[]>("/api/scheduled-jobs", tenantId);
      setScheduledJobs(allJobs.filter((t) => t.agent_id === agentId));
    } catch (err) {
      console.warn("[AgentScheduledJobs] Failed to fetch scheduled jobs:", err);
    }
    try {
      const runsData = await apiFetch<ThreadTurnRow[]>("/api/thread-turns?limit=50", tenantId);
      setRuns(runsData);
    } catch {
      // runs are supplementary
    }
    setLoading(false);
  }, [tenantId, agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!subResult.data?.onThreadTurnUpdated) return;
    fetchData();
  }, [subResult.data, fetchData]);

  const runningJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of runs) {
      if ((r.status === "running" || r.status === "queued") && r.job_id) {
        ids.add(r.job_id);
      }
    }
    return ids;
  }, [runs]);

  if (loading) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Scheduled Jobs</h3>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Add Job
        </button>
      </div>

      {scheduledJobs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No scheduled jobs configured for this agent.</p>
      ) : (
        <DataTable
          columns={scheduledJobColumns(runningJobIds)}
          data={scheduledJobs}
          onRowClick={(row) =>
            navigate({ to: "/agents/$agentId/scheduled-jobs/$scheduledJobId", params: { agentId, scheduledJobId: row.id } })
          }
        />
      )}

      <ScheduledJobFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode="create"
        tenantId={tenantId!}
        initial={{ agent_id: agentId }}
        onSubmit={async (data: ScheduledJobFormData) => {
          await apiFetch("/api/scheduled-jobs", tenantId!, {
            method: "POST",
            body: JSON.stringify({ ...data, agent_id: agentId }),
          });
          fetchData();
        }}
      />
    </div>
  );
}
