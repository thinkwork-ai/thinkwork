import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Archive, Lock, Search } from "lucide-react";
import { Badge, Button, DataTable, Input } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { COMPUTER_NEW_THREAD_ROUTE } from "@/lib/computer-routes";
import { LoadingShimmer } from "@/components/LoadingShimmer";

export interface TaskSummary {
  id: string;
  number?: number | null;
  identifier?: string | null;
  title?: string | null;
  status?: string | null;
  assigneeType?: string | null;
  assigneeId?: string | null;
  agentId?: string | null;
  computerId?: string | null;
  agent?: { id: string; name: string; avatarUrl?: string | null } | null;
  checkoutRunId?: string | null;
  channel?: string | null;
  costSummary?: number | null;
  lastActivityAt?: string | null;
  lastTurnCompletedAt?: string | null;
  lastReadAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface TaskDashboardProps {
  threads: TaskSummary[];
  totalCount: number;
  pageIndex: number;
  pageSize: number;
  search: string;
  isLoading?: boolean;
  error?: string | null;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSearchChange: (search: string) => void;
}

export function TaskDashboard({
  threads,
  totalCount,
  pageIndex,
  pageSize,
  search,
  isLoading = false,
  error,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
}: TaskDashboardProps) {
  usePageHeaderActions({
    title: "Threads",
    subtitle: isLoading ? "Loading..." : `${totalCount} thread${totalCount === 1 ? "" : "s"}`,
  });
  const columns = useMemo<ColumnDef<TaskSummary>[]>(
    () => [
      {
        id: "thread",
        cell: ({ row }) => <ThreadTableRow thread={row.original} />,
      },
    ],
    [],
  );

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-3">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <label className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="pl-9"
              placeholder="Search threads..."
              aria-label="Search threads"
            />
          </label>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Button type="button" variant="ghost" size="sm" disabled>
              Filter
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled>
              Sort
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled>
              Group
            </Button>
            <Button asChild size="sm">
              <Link to={COMPUTER_NEW_THREAD_ROUTE}>New</Link>
            </Button>
          </div>
        </header>

        {error ? (
          <TaskDashboardState label={error} tone="error" />
        ) : isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : threads.length === 0 ? (
          <TaskDashboardState label="No threads match the current search" />
        ) : (
          <section
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            aria-label="Computer threads table"
          >
            <DataTable
              columns={columns}
              data={threads}
              hideHeader
              compact
              scrollable
              pageSize={pageSize}
              totalCount={totalCount}
              pageIndex={pageIndex}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              tableClassName="table-fixed"
            />
          </section>
        )}
      </div>
    </main>
  );
}

function ThreadTableRow({ thread }: { thread: TaskSummary }) {
  const title = thread.title?.trim() || "Untitled thread";
  const identifier = thread.identifier ?? `#${thread.number ?? "?"}`;
  const owner = ownerLabel(thread);
  const updated = thread.lastActivityAt ?? thread.updatedAt ?? thread.createdAt;

  return (
    <Link
      to="/threads/$id"
      params={{ id: thread.id }}
      className="flex h-10 min-w-0 items-center gap-3 overflow-hidden px-3 text-sm"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <StatusDot status={thread.status} />
        <span className="w-[82px] shrink-0 truncate font-mono text-xs text-muted-foreground">
          {identifier}
        </span>
        <span className="min-w-0 truncate text-[0.95rem] font-medium">
          {title}
        </span>
        {thread.checkoutRunId ? (
          <Lock className="size-3.5 shrink-0 text-yellow-500" />
        ) : null}
        {thread.archivedAt ? (
          <Archive className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </span>
      <span className="hidden shrink-0 items-center gap-2 md:flex">
        <Badge variant="outline" className="rounded-full text-xs">
          {owner}
        </Badge>
        {thread.channel ? (
          <span className="w-20 text-xs text-muted-foreground">
            {formatChannel(thread.channel)}
          </span>
        ) : null}
        <span className="w-20 text-right text-xs text-muted-foreground">
          {updated ? relativeTime(updated) : ""}
        </span>
      </span>
    </Link>
  );
}

function StatusDot({ status }: { status?: string | null }) {
  const normalized = String(status ?? "").toLowerCase();
  const color =
    normalized === "done"
      ? "border-emerald-500"
      : normalized === "blocked" || normalized === "cancelled"
        ? "border-destructive"
        : normalized === "in_progress" || normalized === "in review"
          ? "border-blue-500"
          : "border-yellow-500";
  return <span className={`size-3.5 shrink-0 rounded-full border-2 ${color}`} />;
}

function ownerLabel(thread: TaskSummary) {
  if (thread.computerId) return "Computer-owned";
  if (thread.agent?.name) return thread.agent.name;
  if (thread.assigneeType) return formatChannel(thread.assigneeType);
  return "Unassigned";
}

function formatChannel(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function relativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });
  for (const [unit, ms] of units) {
    if (absMs >= ms) {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}

function TaskDashboardState({
  label,
  tone,
}: {
  label: string;
  tone?: "error";
}) {
  return (
    <div className="rounded-lg border border-border/70 p-8 text-center">
      <p
        className={
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        }
      >
        {label}
      </p>
    </div>
  );
}
