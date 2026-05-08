import { useCallback, useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Activity,
  CheckCircle2,
  Clock,
  Info,
  MessageSquare,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { cn, relativeTime } from "@/lib/utils";
import { ComputerEventLevel, ComputerTaskStatus } from "@/gql/graphql";
import { STATUS_COLORS, formatCost } from "@/lib/activity-utils";

type ComputerDashboardTask = {
  id: string;
  taskType: string;
  status: ComputerTaskStatus;
  output?: unknown;
  error?: unknown;
  completedAt?: string | null;
  claimedAt?: string | null;
  createdAt: string;
};

type ComputerDashboardThread = {
  id: string;
  identifier?: string | null;
  number?: number | null;
  title: string;
  status: string;
  channel: string;
  costSummary?: number | null;
  lastResponsePreview?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ComputerDashboardEvent = {
  id: string;
  eventType: string;
  level: ComputerEventLevel;
  payload?: unknown;
  createdAt: string;
};

type ComputerActivityRow = {
  id: string;
  kind: "thread" | "task" | "event";
  type: string;
  title: string;
  status: string;
  cost?: number | null;
  timestamp: number;
  threadId?: string | null;
};

type ComputerDashboardActivityProps = {
  tasks: ComputerDashboardTask[];
  threads: ComputerDashboardThread[];
  events: ComputerDashboardEvent[];
  onRefresh?: () => void;
};

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function taskTimestamp(task: ComputerDashboardTask): number {
  return new Date(
    task.completedAt ?? task.claimedAt ?? task.createdAt,
  ).getTime();
}

function eventStatus(level: ComputerEventLevel): string {
  if (level === ComputerEventLevel.Error) return "failed";
  if (level === ComputerEventLevel.Warn) return "blocked";
  return "completed";
}

function eventTitle(event: ComputerDashboardEvent): string {
  const payload = event.payload;
  if (payload && typeof payload === "object") {
    const message = (payload as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return label(event.eventType);
}

function buildRows(
  tasks: ComputerDashboardTask[],
  threads: ComputerDashboardThread[],
  events: ComputerDashboardEvent[],
): ComputerActivityRow[] {
  const threadRows = threads.map((thread) => ({
    id: `thread:${thread.id}`,
    kind: "thread" as const,
    type: label(thread.channel),
    title: thread.identifier
      ? `${thread.identifier}: ${thread.title}`
      : `#${thread.number ?? "—"}: ${thread.title}`,
    status: thread.status.toLowerCase(),
    cost: thread.costSummary ?? null,
    timestamp: new Date(thread.updatedAt ?? thread.createdAt).getTime(),
    threadId: thread.id,
  }));

  const taskRows = tasks.map((task) => ({
    id: `task:${task.id}`,
    kind: "task" as const,
    type: label(task.taskType),
    title: label(task.taskType),
    status: task.status.toLowerCase(),
    cost: null,
    timestamp: taskTimestamp(task),
    threadId: null,
  }));

  const eventRows = events.map((event) => ({
    id: `event:${event.id}`,
    kind: "event" as const,
    type: "Event",
    title: eventTitle(event),
    status: eventStatus(event.level),
    cost: null,
    timestamp: new Date(event.createdAt).getTime(),
    threadId: null,
  }));

  return [...threadRows, ...taskRows, ...eventRows]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12);
}

function KindIcon({ kind }: { kind: ComputerActivityRow["kind"] }) {
  if (kind === "thread") return <MessageSquare className="h-3 w-3" />;
  if (kind === "task") return <Activity className="h-3 w-3" />;
  return <Info className="h-3 w-3" />;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed" || status === "done") {
    return <CheckCircle2 className="h-3 w-3" />;
  }
  if (status === "failed" || status === "cancelled") {
    return <XCircle className="h-3 w-3" />;
  }
  return <Clock className="h-3 w-3" />;
}

export function ComputerDashboardActivity({
  tasks,
  threads,
  events,
  onRefresh,
}: ComputerDashboardActivityProps) {
  const navigate = useNavigate();
  const rows = useMemo(
    () => buildRows(tasks, threads, events),
    [events, tasks, threads],
  );

  const handleRowClick = useCallback(
    (row: ComputerActivityRow) => {
      if (!row.threadId) return;
      navigate({
        to: "/threads/$threadId",
        params: { threadId: row.threadId },
      });
    },
    [navigate],
  );

  const columns = useMemo(
    (): ColumnDef<ComputerActivityRow>[] => [
      {
        id: "type",
        size: 132,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex items-center pl-3">
              <Badge variant="secondary" className="gap-1 text-xs">
                <KindIcon kind={item.kind} />
                {item.type}
              </Badge>
            </div>
          );
        },
      },
      {
        id: "content",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex h-10 items-center gap-2.5 pr-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">
                {item.title}
              </span>
              <span className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
                <Badge
                  variant="secondary"
                  className={cn(
                    "gap-1 text-xs capitalize",
                    STATUS_COLORS[item.status] ??
                      "bg-muted text-muted-foreground",
                  )}
                >
                  <StatusIcon status={item.status} />
                  {item.status.replace(/_/g, " ")}
                </Badge>
                <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                  {formatCost(item.cost)}
                </span>
                <span className="w-16 text-right text-xs text-muted-foreground">
                  {relativeTime(new Date(item.timestamp).toISOString())}
                </span>
              </span>
            </div>
          );
        },
      },
    ],
    [],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recent Activity</h3>
        <div className="flex items-center gap-3">
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Refresh
            </button>
          ) : null}
          <Link
            to="/analytics"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all activity
          </Link>
        </div>
      </div>
      {rows.length > 0 ? (
        <DataTable
          columns={columns}
          data={rows}
          hideHeader
          compact
          onRowClick={handleRowClick}
          pageSize={0}
          tableClassName="table-fixed"
        />
      ) : (
        <p className="py-4 text-sm text-muted-foreground">No activity yet</p>
      )}
    </div>
  );
}
