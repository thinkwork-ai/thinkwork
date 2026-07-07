import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataTable } from "@thinkwork/ui";
import { formatShortDateTime } from "@/lib/app-artifacts";
import type { ArtifactItem } from "./artifacts-filtering";

const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

export interface ArtifactsTableProps {
  items: ArtifactItem[];
  emptyMessage?: string;
  onRowClick: (item: ArtifactItem) => void;
}

export function ArtifactsTable({
  items,
  emptyMessage,
  onRowClick,
}: ArtifactsTableProps) {
  const columns = useMemo<ColumnDef<ArtifactItem>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Name",
        // Name flexes to absorb the leftover width (the other columns fit
        // their content), truncating only once the table runs out of room.
        meta: {
          headClassName: "w-full min-w-[200px]",
          cellClassName: "w-full min-w-[200px] max-w-0",
        },
        cell: ({ row }) => (
          <span
            className={`${COMPACT_TABLE_CELL} text-sm font-medium`}
            data-row-id={row.original.id}
            data-testid="artifacts-table-row"
            title={row.original.title}
          >
            <span className="truncate">{row.original.title}</span>
          </span>
        ),
      },
      {
        accessorKey: "typeLabel",
        header: "Type",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) =>
          row.original.typeLabel ? (
            <span className={COMPACT_TABLE_CELL}>
              <Badge variant="outline" className="font-normal">
                {row.original.typeLabel}
              </Badge>
            </span>
          ) : (
            <span className={`${COMPACT_TABLE_CELL} text-muted-foreground`}>
              —
            </span>
          ),
      },
      {
        accessorKey: "userName",
        header: "User",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        // Ownerless rows (automation/system jobs with no thread owner) read
        // "System" — a deliberate state, not missing data.
        cell: ({ row }) => (
          <span
            className={`${COMPACT_TABLE_CELL} text-sm text-muted-foreground`}
            title={row.original.userName ?? "System-generated"}
          >
            <span
              className={`max-w-48 truncate ${row.original.userName ? "" : "italic opacity-70"}`}
            >
              {row.original.userName ?? "System"}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "generatedAt",
        header: "Generated",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <span
            className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
          >
            {formatShortDateTime(row.original.generatedAt)}
          </span>
        ),
      },
      {
        accessorKey: "version",
        header: "Version",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) =>
          row.original.version != null ? (
            <span className={`${COMPACT_TABLE_CELL} justify-center`}>
              <Badge variant="outline" className="font-normal">
                v{row.original.version}
              </Badge>
            </span>
          ) : (
            <span
              className={`${COMPACT_TABLE_CELL} justify-center text-muted-foreground`}
            >
              —
            </span>
          ),
      },
    ],
    [],
  );

  if (items.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-muted-foreground"
        data-testid="artifacts-table-empty"
      >
        {emptyMessage ?? "No artifacts yet."}
      </div>
    );
  }

  return (
    <div data-testid="artifacts-table" className="flex min-h-0 flex-1 flex-col">
      <DataTable
        columns={columns}
        data={items}
        onRowClick={onRowClick}
        scrollable
        pageSize={50}
        tableClassName="w-full table-auto"
      />
    </div>
  );
}
