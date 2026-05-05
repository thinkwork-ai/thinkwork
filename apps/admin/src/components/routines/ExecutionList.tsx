/**
 * ExecutionList — paginated, filterable list of routine executions
 * (Plan 2026-05-01-007 §U14).
 *
 * Sits inside the routine detail page. Status filter pills live in URL
 * search params so a reload preserves the operator's view. Cursor
 * pagination keys on `started_at` (the GraphQL resolver enforces).
 *
 * Polling: 5s while at least one execution is non-terminal AND the
 * page is visible (document.visibilityState === "visible"). Terminal-
 * only pages don't waste round trips. AppSync subscription is the
 * deferred upgrade per plan §"Implementation-Time Unknowns".
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "urql";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
  ArrowRight,
  Play,
  Bot,
  Clock,
  Repeat,
  Webhook,
  RefreshCw,
} from "lucide-react";
import { RoutineExecutionsListQuery } from "@/lib/graphql-queries";
import { RoutineExecutionStatus } from "@/gql/graphql";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/utils";

const DEFAULT_PAGE_SIZE = 25;

const TERMINAL_STATUSES = new Set<string>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

/** UI-side status filter id. `all` disables the GraphQL `status` arg;
 * the rest map 1:1 to RoutineExecutionStatus enum members. */
export type StatusFilterId =
  | "all"
  | "running"
  | "succeeded"
  | "failed"
  | "awaiting_approval"
  | "cancelled"
  | "timed_out";

const FILTER_PILLS: Array<{ id: StatusFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "awaiting_approval", label: "Awaiting approval" },
  { id: "succeeded", label: "Succeeded" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "timed_out", label: "Timed out" },
];

function statusFilterToEnum(
  filter: StatusFilterId,
): RoutineExecutionStatus | null {
  switch (filter) {
    case "running":
      return RoutineExecutionStatus.Running;
    case "succeeded":
      return RoutineExecutionStatus.Succeeded;
    case "failed":
      return RoutineExecutionStatus.Failed;
    case "awaiting_approval":
      return RoutineExecutionStatus.AwaitingApproval;
    case "cancelled":
      return RoutineExecutionStatus.Cancelled;
    case "timed_out":
      return RoutineExecutionStatus.TimedOut;
    default:
      return null;
  }
}

/** Normalize an unknown URL search-param value into a valid filter id.
 * Exported for tests. */
export function parseStatusFilter(raw: unknown): StatusFilterId {
  if (typeof raw !== "string") return "all";
  if (FILTER_PILLS.some((p) => p.id === raw)) return raw as StatusFilterId;
  return "all";
}

interface ExecutionRow {
  id: string;
  status: string;
  triggerSource: string;
  startedAt: string | null;
  finishedAt: string | null;
  totalLlmCostUsdCents: number | null;
  errorCode: string | null;
  createdAt: string;
}

export interface ExecutionListProps {
  routineId: string;
  statusFilter: StatusFilterId;
  onStatusFilterChange: (filter: StatusFilterId) => void;
  /** Optional CTA shown in the empty state. */
  emptyCta?: React.ReactNode;
  refreshKey?: number;
}

function triggerIcon(source: string) {
  switch (source) {
    case "manual":
      return <Play className="h-3.5 w-3.5" />;
    case "schedule":
      return <Clock className="h-3.5 w-3.5" />;
    case "webhook":
      return <Webhook className="h-3.5 w-3.5" />;
    case "agent_tool":
      return <Bot className="h-3.5 w-3.5" />;
    case "routine_invoke":
      return <Repeat className="h-3.5 w-3.5" />;
    default:
      return <Play className="h-3.5 w-3.5" />;
  }
}

function formatLlmCost(cents: number | null | undefined): string {
  if (cents == null) return "—";
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDurationMs(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remSeconds}s`;
}

export function ExecutionList({
  routineId,
  statusFilter,
  onStatusFilterChange,
  emptyCta,
  refreshKey,
}: ExecutionListProps) {
  const navigate = useNavigate();
  const enumStatus = statusFilterToEnum(statusFilter);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Cursor stack keeps prior page boundaries so the operator can step
  // back. Index 0 is the first-page cursor (always undefined). Pushing
  // a cursor when paging forward; popping when paging back.
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const currentCursor = cursorStack[cursorStack.length - 1];

  // Reset paging state when the filter changes.
  useEffect(() => {
    setCursorStack([undefined]);
  }, [statusFilter]);

  const [queryResult, refetch] = useQuery({
    query: RoutineExecutionsListQuery,
    variables: {
      routineId,
      status: enumStatus,
      limit: pageSize,
      cursor: currentCursor,
    },
    requestPolicy: "cache-and-network",
  });

  useEffect(() => {
    if (refreshKey == null) return;
    refetch({ requestPolicy: "network-only" });
  }, [refreshKey, refetch]);

  const rows = useMemo<ExecutionRow[]>(
    () =>
      (queryResult.data?.routineExecutions ?? []).map((r) => ({
        id: r.id,
        status: r.status,
        triggerSource: r.triggerSource,
        startedAt: r.startedAt ?? null,
        finishedAt: r.finishedAt ?? null,
        totalLlmCostUsdCents: r.totalLlmCostUsdCents ?? null,
        errorCode: r.errorCode ?? null,
        createdAt: r.createdAt,
      })),
    [queryResult.data],
  );

  const hasNonTerminal = rows.some(
    (r) => !TERMINAL_STATUSES.has(r.status.toLowerCase()),
  );

  // Poll every 5s while the page is visible AND at least one row is
  // non-terminal. Visibility-gate keeps tabs in background quiet.
  useEffect(() => {
    if (!hasNonTerminal) return;
    const tick = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      refetch({ requestPolicy: "network-only" });
    };
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [hasNonTerminal, refetch]);

  const goNextPage = () => {
    const lastRow = rows[rows.length - 1];
    if (!lastRow) return;
    // Cursor convention: server expects the last `started_at` (or
    // `created_at` fallback) of the current page. The resolver returns
    // strictly-older rows than the cursor.
    const cursor = lastRow.startedAt ?? lastRow.createdAt;
    setCursorStack((stack) => [...stack, cursor]);
  };
  const goPrevPage = () => {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  };
  const goFirstPage = () => {
    setCursorStack([undefined]);
  };
  const pageIndex = cursorStack.length - 1;
  const hasPossibleNextPage = rows.length === pageSize;
  const loadedRowCount = pageIndex * pageSize + rows.length;
  const syntheticTotalCount =
    rows.length === 0 && pageIndex > 0
      ? (pageIndex + 1) * pageSize
      : loadedRowCount + (hasPossibleNextPage ? pageSize : 0);
  const handlePageChange = (nextPageIndex: number) => {
    if (nextPageIndex <= 0) {
      goFirstPage();
      return;
    }
    if (nextPageIndex < pageIndex) {
      goPrevPage();
      return;
    }
    if (nextPageIndex > pageIndex) {
      goNextPage();
    }
  };
  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setCursorStack([undefined]);
  };
  const columns = useMemo<ColumnDef<ExecutionRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Run",
        cell: ({ row }) => (
          <div className="flex items-center gap-3 px-3 py-3">
            <span className="text-muted-foreground">
              {triggerIcon(row.original.triggerSource)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.id.slice(0, 8)}
            </span>
          </div>
        ),
        size: 160,
      },
      {
        accessorKey: "triggerSource",
        header: "Trigger",
        cell: ({ row }) => (
          <div className="px-3 py-3 text-sm capitalize text-muted-foreground">
            {row.original.triggerSource.replace(/_/g, " ")}
          </div>
        ),
        size: 150,
      },
      {
        accessorKey: "startedAt",
        header: "Started",
        cell: ({ row }) => (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            {row.original.startedAt
              ? relativeTime(row.original.startedAt)
              : "Pending"}
            {row.original.errorCode ? (
              <span className="ml-2 text-red-500">
                ({row.original.errorCode})
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        cell: ({ row }) => (
          <div className="px-3 py-3 text-right text-sm tabular-nums text-muted-foreground">
            {formatDurationMs(row.original.startedAt, row.original.finishedAt)}
          </div>
        ),
        size: 110,
      },
      {
        accessorKey: "totalLlmCostUsdCents",
        header: "Cost",
        cell: ({ row }) => (
          <div className="px-3 py-3 text-right text-sm tabular-nums text-muted-foreground">
            {formatLlmCost(row.original.totalLlmCostUsdCents)}
          </div>
        ),
        size: 90,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex justify-end px-3 py-3">
            <StatusBadge
              status={row.original.status.toLowerCase()}
              size="sm"
            />
          </div>
        ),
        size: 130,
      },
      {
        id: "action",
        header: "",
        cell: () => (
          <div className="flex items-center justify-end gap-1 px-3 py-3 text-sm text-muted-foreground">
            View output
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        ),
        size: 130,
      },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTER_PILLS.map((pill) => {
          const isActive = pill.id === statusFilter;
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => onStatusFilterChange(pill.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                isActive
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-transparent text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900",
              )}
            >
              {pill.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch({ requestPolicy: "network-only" })}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              queryResult.fetching && "animate-spin",
            )}
          />
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        compact
        tableClassName="table-fixed"
        pageSize={pageSize}
        totalCount={Math.max(syntheticTotalCount, 1)}
        pageIndex={pageIndex}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onRowClick={(row) =>
          navigate({
            to: "/automations/routines/$routineId/executions/$executionId",
            params: { routineId, executionId: row.id },
          })
        }
      />

      {rows.length === 0 && (
        <div className="rounded-md border border-dashed border-border/70 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {statusFilter === "all"
              ? "No executions yet."
              : `No executions match "${FILTER_PILLS.find((p) => p.id === statusFilter)?.label}".`}
          </p>
          {emptyCta ? <div className="mt-3">{emptyCta}</div> : null}
        </div>
      )}
    </div>
  );
}
