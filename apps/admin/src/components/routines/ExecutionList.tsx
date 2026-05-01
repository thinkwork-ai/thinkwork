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
import { Link } from "@tanstack/react-router";
import { Play, Bot, Clock, Repeat, Webhook, RefreshCw } from "lucide-react";
import { RoutineExecutionsListQuery } from "@/lib/graphql-queries";
import { RoutineExecutionStatus } from "@/gql/graphql";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/utils";

const PAGE_SIZE = 25;

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
}: ExecutionListProps) {
  const enumStatus = statusFilterToEnum(statusFilter);

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
      limit: PAGE_SIZE,
      cursor: currentCursor,
    },
    requestPolicy: "cache-and-network",
  });

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
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
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
            className={cn("h-3.5 w-3.5", queryResult.fetching && "animate-spin")}
          />
        </Button>
      </div>

      <Card>
        <CardContent className="py-3">
          {rows.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {statusFilter === "all"
                  ? "No executions yet."
                  : `No executions match "${FILTER_PILLS.find((p) => p.id === statusFilter)?.label}".`}
              </p>
              {emptyCta ? <div className="mt-3">{emptyCta}</div> : null}
            </div>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    to="/automations/routines/$routineId/executions/$executionId"
                    params={{ routineId, executionId: row.id }}
                    className="flex items-center gap-3 px-1 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-md"
                  >
                    <span className="text-zinc-400">
                      {triggerIcon(row.triggerSource)}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                      {row.id.slice(0, 8)}
                    </span>
                    <span className="text-xs text-muted-foreground w-32 shrink-0 capitalize">
                      {row.triggerSource.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                      {row.startedAt ? relativeTime(row.startedAt) : "Pending"}
                      {row.errorCode ? (
                        <span className="ml-2 text-red-500">
                          ({row.errorCode})
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground w-20 shrink-0 text-right tabular-nums">
                      {formatDurationMs(row.startedAt, row.finishedAt)}
                    </span>
                    <span className="text-xs text-muted-foreground w-16 shrink-0 text-right tabular-nums">
                      {formatLlmCost(row.totalLlmCostUsdCents)}
                    </span>
                    <StatusBadge
                      status={row.status.toLowerCase()}
                      size="sm"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {(rows.length > 0 || cursorStack.length > 1) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {cursorStack.length > 1
              ? `Page ${cursorStack.length}`
              : "First page"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goPrevPage}
              disabled={cursorStack.length === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goNextPage}
              disabled={rows.length < PAGE_SIZE}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
