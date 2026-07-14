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
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowRight, Play, Bot, Clock, Repeat, Webhook } from "lucide-react";
import { RoutineExecutionsListQuery } from "@/lib/routine-queries";
import { RoutineExecutionStatus } from "@/gql/graphql";
import {
  DataTable,
  DataTableTokenFilter,
  type DataTableTokenFilterColumn,
  dataTableTokenFilterFns,
} from "@thinkwork/ui";
import { CollapsedFilterSearch } from "@/components/artifacts/CollapsedFilterSearch";
import { StatusBadge } from "@/components/StatusBadge";
import { relativeTime } from "@/lib/utils";

const DEFAULT_PAGE_SIZE = 25;

const TERMINAL_STATUSES = new Set<string>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
  "degraded",
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

// Status is server-filtered (the GraphQL `status` arg), so the token filter
// is a single-select control over the same ids the pills used — clearing it
// returns to "all". A tiny throwaway table satisfies DataTableTokenFilter's
// react-table contract; the actual filtering happens server-side.
const STATUS_FILTER_OPTIONS = FILTER_PILLS.filter((p) => p.id !== "all").map(
  (p) => ({ value: p.id, label: p.label }),
);
const STATUS_FILTER_COLUMNS: ColumnDef<{ filterStatus: string }>[] = [
  {
    id: "filterStatus",
    accessorKey: "filterStatus",
    filterFn: dataTableTokenFilterFns.option,
  },
];
const STATUS_TOKEN_COLUMNS: DataTableTokenFilterColumn[] = [
  {
    id: "filterStatus",
    label: "Status",
    type: "option",
    singleSelect: true,
    options: STATUS_FILTER_OPTIONS,
  },
];
const EMPTY_FILTER_ROWS: { filterStatus: string }[] = [];

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
  const [search, setSearch] = useState("");

  // The token filter's state is derived from the server-owned statusFilter;
  // selecting/clearing routes back through onStatusFilterChange.
  const statusColumnFilters = useMemo<ColumnFiltersState>(
    () =>
      statusFilter === "all"
        ? []
        : [
            {
              id: "filterStatus",
              value: { operator: "is", value: statusFilter },
            },
          ],
    [statusFilter],
  );
  const filterTable = useReactTable({
    data: EMPTY_FILTER_ROWS,
    columns: STATUS_FILTER_COLUMNS,
    state: { columnFilters: statusColumnFilters },
    onColumnFiltersChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(statusColumnFilters) : updater;
      const raw = next.find((c) => c.id === "filterStatus")?.value as
        | { value?: unknown }
        | undefined;
      const picked =
        raw && typeof raw === "object" && "value" in raw
          ? raw.value
          : undefined;
      const value = Array.isArray(picked) ? picked[0] : picked;
      onStatusFilterChange(parseStatusFilter(value));
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

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

  // Free-text search filters the loaded page (run id / trigger / status) —
  // executions have no server-side text field, so this stays page-local.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.id} ${r.triggerSource} ${r.status}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

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
          <div className="flex h-10 items-center gap-3 px-3">
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
          <div className="flex h-10 items-center px-3 text-sm capitalize text-muted-foreground">
            {row.original.triggerSource.replace(/_/g, " ")}
          </div>
        ),
        size: 150,
      },
      {
        accessorKey: "startedAt",
        header: "Started",
        cell: ({ row }) => (
          <div className="flex h-10 items-center px-3 text-sm text-muted-foreground">
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
          <div className="flex h-10 items-center justify-end px-3 text-sm tabular-nums text-muted-foreground">
            {formatDurationMs(row.original.startedAt, row.original.finishedAt)}
          </div>
        ),
        size: 110,
      },
      {
        accessorKey: "totalLlmCostUsdCents",
        header: "Cost",
        cell: ({ row }) => (
          <div className="flex h-10 items-center justify-end px-3 text-sm tabular-nums text-muted-foreground">
            {formatLlmCost(row.original.totalLlmCostUsdCents)}
          </div>
        ),
        size: 90,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex h-10 items-center justify-end px-3">
            <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
          </div>
        ),
        size: 130,
      },
      {
        id: "action",
        header: "",
        cell: () => (
          <div className="flex h-10 items-center justify-end gap-1 px-3 text-sm text-muted-foreground">
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <CollapsedFilterSearch
          value={search}
          onChange={setSearch}
          label="Search runs"
          placeholder="Search runs…"
        />
        <DataTableTokenFilter
          table={filterTable}
          columns={STATUS_TOKEN_COLUMNS}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
      </div>

      <div className="min-h-0 flex-1">
        <DataTable
          columns={columns}
          data={visibleRows}
          scrollable
          tableClassName="table-fixed"
          pageSize={pageSize}
          totalCount={Math.max(syntheticTotalCount, 1)}
          pageIndex={pageIndex}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          onRowClick={(row) =>
            navigate({
              to: "/settings/routines/$routineId/executions/$executionId",
              params: { routineId, executionId: row.id },
            })
          }
          emptyState={
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <p>
                {search.trim()
                  ? "No runs match your search."
                  : statusFilter === "all"
                    ? "No executions yet."
                    : `No executions match "${FILTER_PILLS.find((p) => p.id === statusFilter)?.label}".`}
              </p>
              {emptyCta}
            </div>
          }
        />
      </div>
    </div>
  );
}
