import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useQuery } from "urql";
import {
  Badge,
  DataTable,
  DataTableTokenFilter,
  dataTableTokenFilterFns,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";
import { CircleDot } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { CollapsedFilterSearch } from "@/components/artifacts/CollapsedFilterSearch";
import { StatusBadge } from "@/components/StatusBadge";
import { SettingsWorkflowRunsQuery } from "@/lib/graphql-queries";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { formatDateTime, formatDuration, titleize } from "./workflow-ui";

/**
 * Unified, tenant-wide Runs tab (THINK-218) — workflowRuns queried without a
 * workflowId filter returns every run across every workflow.
 */

type WorkflowRunRow = {
  id: string;
  workflowId: string;
  workflow?: { id: string; name: string } | null;
  status: string;
  triggerFamily: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type WorkflowRunsData = {
  workflowRuns: WorkflowRunRow[];
};

const FILTER_COLUMNS = {
  search: "runSearch",
  status: "runStatus",
} as const;

function runSearchText(row: WorkflowRunRow): string {
  return [row.workflow?.name ?? "", row.status, row.triggerFamily]
    .join(" ")
    .toLowerCase();
}

function uniqueOptions(
  rows: WorkflowRunRow[],
  getValue: (row: WorkflowRunRow) => string,
): string[] {
  return Array.from(new Set(rows.map(getValue).filter(Boolean))).sort();
}

export function WorkflowRunsList({ embedded = false }: { embedded?: boolean }) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const [result] = useQuery<WorkflowRunsData>({
    query: SettingsWorkflowRunsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo(
    () => result.data?.workflowRuns ?? [],
    [result.data?.workflowRuns],
  );

  const filterColumns = useMemo<ColumnDef<WorkflowRunRow>[]>(
    () => [
      {
        id: FILTER_COLUMNS.search,
        accessorFn: runSearchText,
        filterFn: dataTableTokenFilterFns.text,
      },
      {
        id: FILTER_COLUMNS.status,
        accessorFn: (row) => row.status,
        filterFn: dataTableTokenFilterFns.option,
      },
    ],
    [],
  );

  const filterTable = useReactTable({
    data: rows,
    columns: filterColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filteredRows = useMemo(
    () => filterTable.getFilteredRowModel().rows.map((row) => row.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterTable.getState().columnFilters, rows],
  );

  const tokenFilterColumns = useMemo<DataTableTokenFilterColumn[]>(
    () => [
      {
        id: FILTER_COLUMNS.status,
        label: "Status",
        type: "option",
        icon: <CircleDot className="size-4" />,
        options: uniqueOptions(rows, (row) => row.status).map((value) => ({
          value,
          label: titleize(value),
        })),
      },
    ],
    [rows],
  );

  const searchFilter = columnFilters.find(
    (filter) => filter.id === FILTER_COLUMNS.search,
  )?.value;
  const searchValue =
    searchFilter && typeof searchFilter === "object" && "value" in searchFilter
      ? String((searchFilter as { value: unknown }).value ?? "")
      : "";

  const columns = useMemo<ColumnDef<WorkflowRunRow>[]>(
    () => [
      {
        id: "workflow",
        header: "Workflow",
        meta: {
          headClassName: "w-full min-w-[200px]",
          cellClassName: "w-full min-w-[200px] max-w-0",
        },
        cell: ({ row }) => (
          <span className="min-w-0 truncate font-medium text-foreground">
            {row.original.workflow?.name ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
        ),
      },
      {
        accessorKey: "triggerFamily",
        header: "Trigger",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {titleize(row.original.triggerFamily)}
          </Badge>
        ),
      },
      {
        accessorKey: "startedAt",
        header: "Started",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDateTime(row.original.startedAt)}
          </span>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDuration(row.original.startedAt, row.original.finishedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const loading = result.fetching && !result.data;

  return (
    <SettingsTablePane
      title="Runs"
      description="Every workflow run across this tenant, most recent first."
      loading={loading}
      embedded={embedded}
      toolbar={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CollapsedFilterSearch
            value={searchValue}
            onChange={(value) =>
              filterTable
                .getColumn(FILTER_COLUMNS.search)
                ?.setFilterValue(
                  value ? { operator: "contains", value } : undefined,
                )
            }
            label="Search runs"
            placeholder="Search runs…"
          />
          <DataTableTokenFilter
            table={filterTable}
            columns={tokenFilterColumns}
            addLabel="Filter"
            showAddLabel={false}
            clearLabel="Clear filters"
            flattenToolbar
            className="max-w-full [&_[data-token-filter-token]]:shrink-0"
            popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
          />
        </div>
      }
    >
      {result.error ? (
        <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
          {result.error.message}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredRows}
          scrollable
          allowHorizontalScroll={false}
          pageSize={25}
          tableClassName="w-full table-auto"
          onRowClick={(row) =>
            navigate({
              to: "/settings/workflows/$workflowId/runs/$runId",
              params: { workflowId: row.workflowId, runId: row.id },
            })
          }
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? "No workflow runs recorded yet."
                : "No runs match the current filters."}
            </div>
          }
        />
      )}
    </SettingsTablePane>
  );
}
