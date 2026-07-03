import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

import { DecisionPanel } from "../../genui/components/DecisionPanel";
import type { ThreadJsonRenderDurableActionDescriptor } from "../validation";
import type { JsonRenderActionStatus } from "../use-json-render-action";

type TableCellValue = string | number | boolean | null;

type TableRow = Record<string, TableCellValue>;

interface TableColumn {
  id: string;
  header: string;
  accessor?: string | null;
  align?: "left" | "right" | "center" | null;
  sortable?: boolean;
}

export interface DataTableViewProps {
  title?: string | null;
  caption?: string | null;
  columns?: TableColumn[];
  rows?: TableRow[];
  sort?: { columnId: string; direction: "asc" | "desc" } | null;
  actions?: ThreadJsonRenderDurableActionDescriptor[];
  actionsDisabled?: boolean;
  onAction?: (action: ThreadJsonRenderDurableActionDescriptor) => void;
  statusForAction?: (
    action: ThreadJsonRenderDurableActionDescriptor,
  ) => JsonRenderActionStatus;
}

export function DataTableView({
  title,
  caption,
  columns,
  rows,
  sort,
  actions = [],
  actionsDisabled = true,
  onAction,
  statusForAction,
}: DataTableViewProps) {
  // Partial-frame tolerance (KTD7): during streaming, columns/rows may not have
  // arrived yet. Fall back to safe defaults and never throw.
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRows = Array.isArray(rows) ? rows : [];

  const rowsHaveActions = safeRows.some(
    (row) =>
      typeof row?.primaryActionId === "string" ||
      typeof row?.secondaryActionId === "string",
  );

  const tableColumns = useMemo<ColumnDef<TableRow>[]>(
    () =>
      safeColumns.map((column) => {
        const accessorKey = column.accessor ?? column.id;
        return {
          id: column.id,
          accessorFn: (row) => row[accessorKey],
          header: column.header,
          enableSorting: column.sortable ?? false,
          meta: { align: column.align ?? "left" },
        } satisfies ColumnDef<TableRow>;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(safeColumns)],
  );

  const [sorting, setSorting] = useState<SortingState>(() =>
    sort ? [{ id: sort.columnId, desc: sort.direction === "desc" }] : [],
  );

  const table = useReactTable({
    data: safeRows,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    // Read-first default: the first click on any column sorts ascending,
    // regardless of the inferred value type (tanstack defaults numeric columns
    // to descending-first, which is surprising for a data readout).
    sortDescFirst: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const hasColumns = safeColumns.length > 0;

  return (
    <section
      aria-label={title ?? "Table"}
      className="grid gap-2 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
      data-testid="json-render-table"
    >
      {title ? (
        <header className="min-w-0">
          <h3 className="text-sm font-semibold leading-5 text-foreground">
            {title}
          </h3>
        </header>
      ) : null}

      {hasColumns ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            {caption ? (
              <caption className="pb-2 text-left text-xs text-muted-foreground">
                {caption}
              </caption>
            ) : null}
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  className="border-b border-border"
                  key={headerGroup.id}
                >
                  {headerGroup.headers.map((header) => {
                    const align =
                      (header.column.columnDef.meta as { align?: string })
                        ?.align ?? "left";
                    const canSort = header.column.getCanSort();
                    const sortDirection = header.column.getIsSorted();
                    const headerContent = flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    );
                    return (
                      <th
                        className="px-2 py-1.5 text-xs font-semibold uppercase tracking-normal text-muted-foreground"
                        key={header.id}
                        scope="col"
                        style={{ textAlign: align as "left" | "right" | "center" }}
                      >
                        {canSort ? (
                          <button
                            className="inline-flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground"
                            onClick={header.column.getToggleSortingHandler()}
                            type="button"
                          >
                            <span>{headerContent}</span>
                            <SortIcon direction={sortDirection} />
                          </button>
                        ) : (
                          headerContent
                        )}
                      </th>
                    );
                  })}
                  {rowsHaveActions ? (
                    <th
                      className="px-2 py-1.5 text-right text-xs font-semibold uppercase text-muted-foreground"
                      scope="col"
                    >
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const rowActions = actionsForRow(row.original, actions);
                return (
                  <tr
                    className="border-b border-border/60 last:border-b-0"
                    key={row.id}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const align =
                        (cell.column.columnDef.meta as { align?: string })
                          ?.align ?? "left";
                      return (
                        <td
                          className="px-2 py-1.5 text-foreground"
                          key={cell.id}
                          style={{
                            textAlign: align as "left" | "right" | "center",
                          }}
                        >
                          {formatCell(cell.getValue() as TableCellValue)}
                        </td>
                      );
                    })}
                    {rowsHaveActions ? (
                      <td className="px-2 py-1.5 text-right">
                        {rowActions.length ? (
                          <DecisionPanel
                            actions={rowActions}
                            disabled={actionsDisabled}
                            onAction={onAction}
                            pendingLabel="Unavailable"
                            primaryActionId={
                              typeof row.original.primaryActionId === "string"
                                ? row.original.primaryActionId
                                : undefined
                            }
                            statusForAction={statusForAction}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-muted/25 p-3">
          <p className="text-sm text-muted-foreground">Preparing table…</p>
        </div>
      )}
    </section>
  );
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") return <ChevronUp className="size-3" />;
  if (direction === "desc") return <ChevronDown className="size-3" />;
  return <ChevronsUpDown className="size-3 opacity-60" />;
}

function actionsForRow(
  row: TableRow,
  actions: ThreadJsonRenderDurableActionDescriptor[],
) {
  const ids = [row.primaryActionId, row.secondaryActionId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return ids
    .map((id) => actions.find((action) => action.id === id))
    .filter(
      (action): action is ThreadJsonRenderDurableActionDescriptor =>
        action !== undefined,
    );
}

function formatCell(value: TableCellValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
