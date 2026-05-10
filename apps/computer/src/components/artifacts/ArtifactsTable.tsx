import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataTable } from "@thinkwork/ui";
import { formatShortDate, shortModel } from "@/lib/app-artifacts";
import type { ArtifactItem } from "./artifacts-filtering";

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
        size: 240,
        cell: ({ row }) => (
          <span
            className="block truncate text-sm font-medium"
            data-row-id={row.original.id}
            data-testid="artifacts-table-row"
            title={row.original.title}
          >
            {row.original.title}
          </span>
        ),
      },
      {
        accessorKey: "kind",
        header: "Kind",
        size: 100,
        cell: ({ row }) => (
          <Badge variant="outline" className="uppercase tracking-wide">
            {row.original.kind}
          </Badge>
        ),
      },
      {
        accessorKey: "modelId",
        header: "Model",
        size: 160,
        cell: ({ row }) => (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={row.original.modelId ?? undefined}
          >
            {shortModel(row.original.modelId)}
          </span>
        ),
      },
      {
        accessorKey: "stdlibVersion",
        header: "Stdlib",
        size: 100,
        cell: ({ row }) => (
          <span className="block text-xs text-muted-foreground">
            {row.original.stdlibVersion ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "generatedAt",
        header: "Generated",
        size: 120,
        cell: ({ row }) => (
          <span className="block text-xs text-muted-foreground">
            {formatShortDate(row.original.generatedAt)}
          </span>
        ),
      },
      {
        accessorKey: "version",
        header: "Version",
        size: 90,
        cell: ({ row }) =>
          row.original.version != null ? (
            <Badge variant="outline" className="font-normal">
              v{row.original.version}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
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
        tableClassName="table-fixed"
      />
    </div>
  );
}

