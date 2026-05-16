import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "../ui/badge.js";
import { DataTable } from "../ui/data-table.js";
import { RUN_STATUS_COLORS, type ScheduledJobRunRow } from "./types.js";
import { formatRunDuration, runDurationMs } from "./helpers.js";

export interface RunHistoryTableProps {
  runs: ScheduledJobRunRow[];
  onRowClick: (run: ScheduledJobRunRow) => void;
  /**
   * Per-app relative-time formatter (admin and computer each ship their
   * own `Intl.RelativeTimeFormat` wrapper today; passing it in keeps the
   * shared component from duplicating that logic).
   */
  formatRelativeTime: (iso: string) => string;
  /** Defaults to 10 to match the operator's preferred page size. */
  pageSize?: number;
}

/**
 * DataTable presentation of a scheduled job's run history. Columns:
 *   Status · Source · Started · Duration
 * Click-through fires `onRowClick` (host page opens its detail Sheet).
 */
export function RunHistoryTable({
  runs,
  onRowClick,
  formatRelativeTime,
  pageSize = 10,
}: RunHistoryTableProps) {
  const columns: ColumnDef<ScheduledJobRunRow>[] = [
    {
      accessorKey: "status",
      header: "Status",
      size: 110,
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={`text-xs capitalize ${RUN_STATUS_COLORS[row.original.status] || ""}`}
        >
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "invocation_source",
      header: "Source",
      size: 130,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs capitalize">
          {row.original.invocation_source.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      accessorKey: "started_at",
      header: "Started",
      size: 140,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.started_at ? formatRelativeTime(row.original.started_at) : "Queued"}
        </span>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      size: 100,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatRunDuration(runDurationMs(row.original))}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={runs}
      onRowClick={onRowClick}
      pageSize={pageSize}
      tableClassName="table-fixed"
    />
  );
}
