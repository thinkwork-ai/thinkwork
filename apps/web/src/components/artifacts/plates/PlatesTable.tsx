/**
 * Plate registry (THINK-153 U6) — the plates list table.
 *
 * Follows the Work Items list idiom: a hidden-column react-table drives the
 * token filters (origin, state) + collapsed search, and the visible rows
 * render through the shared DataTable. Edit/Clone live in the preview panel
 * inline, always visible, outline style — matching ArtifactsTable / work-items.
 */

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Badge,
  DataTable,
  DataTableTokenFilter,
  type DataTableTokenFilterColumn,
  dataTableTokenFilterFns,
} from "@thinkwork/ui";
import type { PlateItem } from "./plate-support";
import { CollapsedFilterSearch } from "../CollapsedFilterSearch";

const CELL = "flex h-10 min-w-0 items-center";

const FILTER_COLUMNS = {
  search: "filterSearch",
  origin: "filterOrigin",
  state: "filterState",
} as const;

export interface PlatesTableProps {
  items: PlateItem[];
  selectedSlug: string | null;
  onRowClick: (item: PlateItem) => void;
  /** Operators only: inline row actions + the state (hidden) filter. */
  isOperator?: boolean;
  emptyMessage?: string;
}

interface PlateFilterRow {
  item: PlateItem;
  filterSearch: string;
  filterOrigin: string;
  filterState: string;
}

export function PlatesTable({
  items,
  selectedSlug,
  onRowClick,
  isOperator = false,
  emptyMessage,
}: PlatesTableProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const filterRows = useMemo<PlateFilterRow[]>(
    () =>
      [...items]
        .sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, {
            sensitivity: "base",
          }),
        )
        .map((item) => ({
          item,
          filterSearch: `${item.displayName} ${item.slug} ${item.useFor}`,
          filterOrigin: item.origin,
          filterState: item.hidden ? "hidden" : "visible",
        })),
    [items],
  );

  const filterColumns = useMemo<ColumnDef<PlateFilterRow>[]>(
    () => [
      {
        id: FILTER_COLUMNS.search,
        accessorKey: "filterSearch",
        filterFn: dataTableTokenFilterFns.text,
      },
      {
        id: FILTER_COLUMNS.origin,
        accessorKey: "filterOrigin",
        filterFn: dataTableTokenFilterFns.option,
      },
      {
        id: FILTER_COLUMNS.state,
        accessorKey: "filterState",
        filterFn: dataTableTokenFilterFns.option,
      },
    ],
    [],
  );

  const filterTable = useReactTable({
    data: filterRows,
    columns: filterColumns,
    autoResetPageIndex: false,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filteredItems = filterTable
    .getFilteredRowModel()
    .rows.map((row) => row.original.item);

  const searchFilterValue = columnFilters.find(
    (filter) => filter.id === FILTER_COLUMNS.search,
  )?.value;
  const searchValue =
    searchFilterValue &&
    typeof searchFilterValue === "object" &&
    "value" in searchFilterValue &&
    typeof (searchFilterValue as { value: unknown }).value === "string"
      ? (searchFilterValue as { value: string }).value
      : "";

  const tokenFilterColumns = useMemo<DataTableTokenFilterColumn[]>(() => {
    const columns: DataTableTokenFilterColumn[] = [
      {
        id: FILTER_COLUMNS.origin,
        label: "Origin",
        type: "option",
        options: [
          { value: "platform", label: "Platform" },
          { value: "tenant", label: "Custom" },
        ],
      },
    ];
    // Hidden plates only ever reach operators (the server filters them out for
    // members), so the state filter is operator-only too.
    if (isOperator) {
      columns.push({
        id: FILTER_COLUMNS.state,
        label: "State",
        type: "option",
        options: [
          { value: "visible", label: "Visible" },
          { value: "hidden", label: "Hidden" },
        ],
      });
    }
    return columns;
  }, [isOperator]);

  const columns = useMemo<ColumnDef<PlateItem>[]>(() => {
    const base: ColumnDef<PlateItem>[] = [
      {
        accessorKey: "displayName",
        header: "Name",
        size: 190,
        cell: ({ row }) => (
          <span
            className={`${CELL} gap-2`}
            data-testid="plates-table-row"
            data-slug={row.original.slug}
          >
            <span className="truncate text-sm font-medium">
              {row.original.displayName}
            </span>
            {row.original.hidden ? (
              <Badge
                variant="outline"
                className="font-normal text-muted-foreground"
                data-testid="plates-hidden-badge"
              >
                Hidden
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: "slug",
        header: "Type",
        size: 180,
        cell: ({ row }) => (
          <span className={CELL}>
            <Badge
              variant="outline"
              className="max-w-full font-mono text-xs font-normal text-muted-foreground"
            >
              <span className="truncate">{row.original.slug}</span>
            </Badge>
          </span>
        ),
      },
      {
        accessorKey: "useFor",
        header: "Use for",
        cell: ({ row }) => (
          <span
            className={`${CELL} text-sm text-muted-foreground`}
            title={row.original.useFor}
          >
            <span className="truncate">{row.original.useFor || "—"}</span>
          </span>
        ),
      },
      {
        accessorKey: "origin",
        header: "Origin",
        size: 110,
        cell: ({ row }) => (
          <span className={`${CELL} gap-1.5`}>
            <Badge variant="outline" className="font-normal">
              {row.original.origin === "tenant" ? "Custom" : "Platform"}
            </Badge>
            {row.original.origin === "platform" && row.original.customized ? (
              <Badge
                variant="secondary"
                className="font-normal"
                data-testid="plates-customized-badge"
              >
                Customized
              </Badge>
            ) : null}
          </span>
        ),
      },
    ];

    return base;
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <CollapsedFilterSearch
          value={searchValue}
          onChange={(value) =>
            filterTable
              .getColumn(FILTER_COLUMNS.search)
              ?.setFilterValue(
                value ? { operator: "contains", value } : undefined,
              )
          }
          label="Search plates"
          placeholder="Search plates..."
        />
        <DataTableTokenFilter
          table={filterTable}
          columns={tokenFilterColumns}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
      </div>

      {filteredItems.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-muted-foreground"
          data-testid="plates-table-empty"
        >
          {emptyMessage ?? "No plates match your filters."}
        </div>
      ) : (
        <div
          data-testid="plates-table"
          data-selected-slug={selectedSlug ?? undefined}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DataTable
            columns={columns}
            data={filteredItems}
            onRowClick={onRowClick}
            scrollable
            pageSize={50}
            tableClassName="w-full table-fixed"
          />
        </div>
      )}
    </div>
  );
}
