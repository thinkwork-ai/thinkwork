import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Play, Pause, Zap, Clock, Plus, Loader2 } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useSubscription } from "urql";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@thinkwork/ui";
import { ThreadTurnUpdatedSubscription } from "@/lib/graphql-queries";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  ScheduledJobForm,
  type ScheduledJobFormData,
} from "@/components/scheduled-jobs/ScheduledJobForm";
import {
  estimateNextRun,
  formatSchedule,
  JOB_TYPE_LABELS,
  relativeTime,
  type ScheduledJobRow,
  type ThreadTurnRow,
} from "./-automations.utils";

export const Route = createFileRoute("/_authed/_shell/automations/")({
  component: AutomationsPage,
});

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

const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

function jobColumns(runningIds: Set<string>): ColumnDef<ScheduledJobRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div
          className={`${COMPACT_TABLE_CELL} flex-col items-start justify-center gap-0.5 overflow-hidden`}
        >
          <span className="max-w-full truncate font-medium leading-4">
            {row.original.name}
          </span>
          {row.original.description && (
            <span className="max-w-full truncate text-xs leading-3 text-muted-foreground">
              {row.original.description}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => (
        <span className={COMPACT_TABLE_CELL}>
          <Badge variant="secondary" className="gap-1 text-xs">
            <Zap className="h-3.5 w-3.5" />
            {JOB_TYPE_LABELS[row.original.trigger_type] ??
              row.original.trigger_type}
          </Badge>
        </span>
      ),
      size: 160,
    },
    {
      accessorKey: "schedule_expression",
      header: "Schedule",
      cell: ({ row }) => (
        <div className={`${COMPACT_TABLE_CELL} gap-1.5`}>
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate text-xs">
            {formatSchedule(row.original.schedule_expression)}
          </span>
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
            <span className={COMPACT_TABLE_CELL}>
              <Badge
                variant="secondary"
                className="text-xs gap-1 bg-muted text-muted-foreground"
              >
                <Pause className="h-3 w-3" /> Disabled
              </Badge>
            </span>
          );
        }
        if (isRunning) {
          return (
            <span className={COMPACT_TABLE_CELL}>
              <Badge
                variant="secondary"
                className="text-xs gap-1 bg-blue-500/15 text-blue-600 dark:text-blue-400"
              >
                <Loader2 className="h-3 w-3 animate-spin" /> Running
              </Badge>
            </span>
          );
        }
        return (
          <span className={COMPACT_TABLE_CELL}>
            <Badge
              variant="secondary"
              className="text-xs gap-1 bg-green-500/15 text-green-600 dark:text-green-400"
            >
              <Play className="h-3 w-3 fill-current" /> Idle
            </Badge>
          </span>
        );
      },
      size: 110,
    },
    {
      accessorKey: "last_run_at",
      header: "Last Run",
      cell: ({ row }) => (
        <span className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}>
          {row.original.last_run_at
            ? relativeTime(row.original.last_run_at)
            : "Never"}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: "next_run_at",
      header: "Next Run",
      cell: ({ row }) => {
        if (!row.original.enabled) {
          return (
            <span
              className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
            >
              —
            </span>
          );
        }
        const nextDb = row.original.next_run_at;
        const estimated = estimateNextRun(
          row.original.schedule_expression,
          row.original.last_run_at,
        );
        const nextDate = nextDb ? new Date(nextDb) : estimated;
        if (!nextDate) {
          return (
            <span
              className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
            >
              —
            </span>
          );
        }
        return (
          <span
            className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
          >
            {relativeTime(nextDate.toISOString())}
          </span>
        );
      },
      size: 120,
    },
  ];
}

function AddJobButton({
  agentId,
  onAdd,
}: {
  agentId: string | null;
  onAdd: () => void;
}) {
  if (!agentId) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button
                variant="ghost"
                size="sm"
                disabled
                className="text-muted-foreground"
              >
                <Plus className="h-4 w-4 mr-1" /> Add Job
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            The tenant agent is still loading — try again in a moment.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={onAdd}
    >
      <Plus className="h-4 w-4 mr-1" /> Add Job
    </Button>
  );
}

function AutomationsPage() {
  const { tenantId, userId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [jobs, setJobs] = useState<ScheduledJobRow[]>([]);
  const [runs, setRuns] = useState<ThreadTurnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The tenant platform agent owns scheduled jobs created here (the legacy
  // per-Computer source agent was removed with the Computer concept).
  const [agentResult] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const agentId = agentResult.data?.agent?.id ?? null;

  const [subResult] = useSubscription({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId ?? "" },
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!subResult.data?.onThreadTurnUpdated) return;
    fetchData();
  }, [subResult.data, fetchData]);

  const runningJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of runs) {
      if ((r.status === "running" || r.status === "queued") && r.trigger_id) {
        ids.add(r.trigger_id);
      }
    }
    return ids;
  }, [runs]);

  // Main-nav Automations shows the caller's own scheduled jobs ("my
  // automations"); the operator-wide view lives in Settings.
  const myJobs = useMemo(
    () =>
      jobs.filter(
        (j) => j.created_by_type === "user" && j.created_by_id === userId,
      ),
    [jobs, userId],
  );

  const filteredJobs = useMemo(() => {
    if (!search) return myJobs;
    const q = search.toLowerCase();
    return myJobs.filter(
      (j) =>
        j.name.toLowerCase().includes(q) ||
        (j.description?.toLowerCase().includes(q) ?? false),
    );
  }, [myJobs, search]);

  usePageHeaderActions({ title: "Automations" });

  async function handleCreate(data: ScheduledJobFormData) {
    if (!tenantId) return;
    await apiFetch("/api/scheduled-jobs", tenantId, {
      method: "POST",
      body: JSON.stringify(data),
    });
    await fetchData();
    setCreating(false);
  }

  if (!tenantId || loading) {
    return <PageSkeleton />;
  }

  // Full-page create replaces the list (no modal). agentId fires the job.
  if (creating && agentId) {
    return (
      <main className="h-full w-full overflow-y-auto bg-background">
        <ScheduledJobForm
          mode="create"
          agentId={agentId}
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
        />
      </main>
    );
  }

  if (myJobs.length === 0 && !error) {
    return (
      <main className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="flex h-full min-h-0 flex-col gap-4 px-2 py-4 sm:px-4">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <label className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                placeholder="Search jobs..."
                aria-label="Search jobs"
              />
            </label>
            <AddJobButton agentId={agentId} onAdd={() => setCreating(true)} />
          </header>
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-12 text-center">
            <p className="text-base font-medium">No automations yet</p>
            <p className="text-sm text-muted-foreground">
              Scheduled jobs created from this workspace will appear here.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full min-h-0 flex-col gap-4 px-2 py-4 sm:px-4">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <label className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              placeholder="Search jobs..."
              aria-label="Search jobs"
            />
          </label>
          <AddJobButton agentId={agentId} onAdd={() => setCreating(true)} />
        </header>
        {error && <p className="shrink-0 text-sm text-destructive">{error}</p>}

        <DataTable
          columns={jobColumns(runningJobIds)}
          data={filteredJobs}
          filterValue={search}
          filterColumn="name"
          pageSize={10}
          onRowClick={(row) =>
            navigate({
              to: "/automations/$scheduledJobId",
              params: { scheduledJobId: row.id },
            })
          }
        />
      </div>
    </main>
  );
}
