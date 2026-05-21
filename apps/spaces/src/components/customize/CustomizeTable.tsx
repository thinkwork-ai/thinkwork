import { useMemo } from "react";
import { Check } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataTable } from "@thinkwork/ui";
import type { CustomizeItem } from "./customize-filtering";

export interface CustomizeTableProps {
  items: CustomizeItem[];
  emptyMessage?: string;
  onRowClick: (item: CustomizeItem) => void;
}

/**
 * DataTable for the Customize catalog. Multi-column ColumnDef so the
 * header row renders (matches the Memory Brain table). Compact 40px
 * row height + scrollable body + onRowClick (no inline Link) — the
 * row click opens CustomizeDetailSheet via the parent.
 */
export function CustomizeTable({
  items,
  emptyMessage,
  onRowClick,
}: CustomizeTableProps) {
  const columns = useMemo<ColumnDef<CustomizeItem>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 180,
        cell: ({ row }) => (
          <span
            className="block truncate text-sm font-medium"
            data-row-id={row.original.id}
            data-connected={row.original.connected ? "true" : "false"}
            data-testid="customize-table-row"
            title={row.original.name}
          >
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "typeBadge",
        header: "Type",
        size: 80,
        cell: ({ row }) =>
          row.original.typeBadge ? (
            <Badge variant="outline" className="uppercase tracking-wide">
              {row.original.typeBadge}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "category",
        header: "Category",
        size: 150,
        cell: ({ row }) =>
          row.original.category ? (
            <Badge variant="secondary" className="font-normal">
              {row.original.category}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={row.original.description ?? undefined}
          >
            {row.original.description ?? ""}
          </span>
        ),
      },
      {
        accessorKey: "connected",
        header: "Status",
        size: 130,
        cell: ({ row }) => (
          <div className="flex">
            {row.original.connected ? (
              <Badge
                variant="outline"
                className="gap-1 border-green-500 text-green-500"
              >
                <Check className="h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Available
              </Badge>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  if (items.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-muted-foreground"
        data-testid="customize-table-empty"
      >
        {emptyMessage ?? "Nothing here yet."}
      </div>
    );
  }

  return (
    <div data-testid="customize-table" className="flex min-h-0 flex-1 flex-col">
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
