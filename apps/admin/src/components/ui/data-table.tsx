import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Global filter value (controlled externally) */
  filterValue?: string;
  /** Column id to apply filterValue to. Defaults to global filter if omitted. */
  filterColumn?: string;
  /** Callback when a row is clicked */
  onRowClick?: (row: TData) => void;
  /** Page size for pagination. 0 = no pagination. Default 20. */
  pageSize?: number;
  /** Hide the table header row */
  hideHeader?: boolean;
  /** Enable row selection with checkboxes */
  enableRowSelection?: boolean;
  /** Render prop for toolbar content above the table */
  toolbar?: (table: ReturnType<typeof useReactTable<TData>>) => React.ReactNode;
  /** Additional className for the <table> element */
  tableClassName?: string;
  /** Disable horizontal scrolling and clip overflowing fixed-width content. */
  allowHorizontalScroll?: boolean;
  /** When true, table body scrolls within its container and pagination sticks to bottom. Parent must constrain height. */
  scrollable?: boolean;
  /** Server-side pagination: total row count (enables manual pagination mode) */
  totalCount?: number;
  /** Server-side pagination: current page index (0-based) */
  pageIndex?: number;
  /** Server-side pagination: callback when page changes */
  onPageChange?: (pageIndex: number) => void;
  /** Server-side pagination: callback when page size changes */
  onPageSizeChange?: (pageSize: number) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  filterValue,
  filterColumn,
  onRowClick,
  pageSize = 10,
  hideHeader = false,
  enableRowSelection = false,
  toolbar,
  tableClassName,
  allowHorizontalScroll = true,
  scrollable = false,
  totalCount,
  pageIndex: controlledPageIndex,
  onPageChange,
  onPageSizeChange,
}: DataTableProps<TData, TValue>) {
  const manualPagination = totalCount != null;
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  // Sync external filter → internal column filter
  React.useEffect(() => {
    if (filterColumn && filterValue !== undefined) {
      setColumnFilters((prev) => {
        const others = prev.filter((f) => f.id !== filterColumn);
        if (filterValue) {
          return [...others, { id: filterColumn, value: filterValue }];
        }
        return others;
      });
    }
  }, [filterValue, filterColumn]);

  const table = useReactTable({
    data,
    columns,
    autoResetPageIndex: false,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    ...(pageSize > 0 && !manualPagination
      ? { getPaginationRowModel: getPaginationRowModel() }
      : {}),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: enableRowSelection ? setRowSelection : undefined,
    enableRowSelection,
    globalFilterFn: "includesString",
    ...(manualPagination ? {
      manualPagination: true,
      pageCount: Math.ceil(totalCount! / pageSize),
      onPaginationChange: (updater: any) => {
        const current = { pageIndex: controlledPageIndex ?? 0, pageSize };
        const next = typeof updater === "function" ? updater(current) : updater;
        if (next.pageIndex !== current.pageIndex) onPageChange?.(next.pageIndex);
        if (next.pageSize !== current.pageSize) onPageSizeChange?.(next.pageSize);
      },
    } : {}),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      ...(enableRowSelection ? { rowSelection } : {}),
      ...(filterValue !== undefined && !filterColumn
        ? { globalFilter: filterValue }
        : {}),
      ...(manualPagination ? { pagination: { pageIndex: controlledPageIndex ?? 0, pageSize } } : {}),
    },
    ...(filterValue !== undefined && !filterColumn
      ? { onGlobalFilterChange: () => {} }
      : {}),
    ...(!manualPagination && pageSize > 0 ? { initialState: { pagination: { pageSize } } } : {}),
  });

  const colgroup = tableClassName?.includes("table-fixed") ? (
    <colgroup>
      {table.getAllColumns().map((col) => {
        const size = col.columnDef.size;
        const hasExplicitSize = size !== undefined && size !== 150;
        return (
          <col
            key={col.id}
            style={hasExplicitSize ? { width: size } : undefined}
          />
        );
      })}
    </colgroup>
  ) : null;

  const headerRow = !hideHeader ? (
    <TableHeader className={scrollable ? "sticky top-0 z-10 bg-background" : undefined}>
      {table.getHeaderGroups().map((headerGroup) => (
        <TableRow key={headerGroup.id}>
          {headerGroup.headers.map((header) => (
            <TableHead key={header.id}>
              {header.isPlaceholder
                ? null
                : flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
            </TableHead>
          ))}
        </TableRow>
      ))}
    </TableHeader>
  ) : null;

  const bodyRows = (
    <TableBody>
      {table.getRowModel().rows?.length ? (
        table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            data-state={row.getIsSelected() && "selected"}
            className={[
              "h-10 [&>td]:py-0 [&>td]:overflow-hidden",
              onRowClick ? "cursor-pointer" : undefined,
            ].filter(Boolean).join(" ")}
            onClick={() => onRowClick?.(row.original)}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className={tableClassName?.includes("table-fixed") ? "overflow-hidden" : undefined}>
                {flexRender(
                  cell.column.columnDef.cell,
                  cell.getContext(),
                )}
              </TableCell>
            ))}
          </TableRow>
        ))
      ) : (
        <TableRow className="h-10 [&>td]:py-0 [&>td]:overflow-hidden">
          <TableCell
            colSpan={columns.length}
            className="text-center text-muted-foreground"
          >
            No results.
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );

  const pagination = pageSize > 0 ? (
    <DataTablePagination table={table} />
  ) : null;

  return (
    <div className={scrollable ? "flex flex-col h-full" : undefined}>
      {toolbar && (
        <div className={scrollable ? "shrink-0 flex items-center py-3" : "flex items-center py-3"}>
          {toolbar(table)}
        </div>
      )}

      <div className={scrollable ? "flex-1 min-h-0 overflow-y-auto rounded-md border" : allowHorizontalScroll ? "overflow-x-auto rounded-md border" : "overflow-hidden rounded-md border"}>
        <Table className={tableClassName} containerClassName={allowHorizontalScroll ? undefined : "overflow-hidden"}>
          {colgroup}
          {headerRow}
          {bodyRows}
        </Table>
      </div>

      {/* Pagination */}
      {pagination && (
        <div className={scrollable ? "shrink-0" : undefined}>
          {pagination}
        </div>
      )}
    </div>
  );
}
