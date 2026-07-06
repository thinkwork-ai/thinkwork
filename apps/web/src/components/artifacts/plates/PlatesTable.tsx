/**
 * Plate registry (THINK-153 U6) — the plates list table.
 *
 * Follows the Work Items list idiom: a hidden-column react-table drives the
 * token filters (origin, state) + collapsed search, and the visible rows
 * render through the shared DataTable. Operator row actions (Edit, Clone) are
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
import { Copy, Pencil, Search } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DataTableTokenFilter,
  type DataTableTokenFilterColumn,
  dataTableTokenFilterFns,
  Input,
} from "@thinkwork/ui";
import { summarizeDirectives, type PlateItem } from "./plate-support";

const CELL = "flex h-10 min-w-0 items-center px-2";

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
  onEdit?: (item: PlateItem) => void;
  onClone?: (item: PlateItem) => void;
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
  onEdit,
  onClone,
  emptyMessage,
}: PlatesTableProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const filterRows = useMemo<PlateFilterRow[]>(
    () =>
      items.map((item) => ({
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
        size: 240,
        cell: ({ row }) => (
          <span
            className={`${CELL} flex-col !items-start justify-center gap-0`}
            data-testid="plates-table-row"
            data-slug={row.original.slug}
          >
            <span className="truncate text-sm font-medium">
              {row.original.displayName}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {row.original.slug}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "useFor",
        header: "Use for",
        size: 220,
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
        size: 130,
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
      {
        accessorKey: "allowedDirectives",
        header: "Components",
        size: 160,
        cell: ({ row }) => (
          <span className={`${CELL} text-xs text-muted-foreground`}>
            <span className="truncate">
              {summarizeDirectives(row.original.allowedDirectives)}
            </span>
          </span>
        ),
      },
      {
        id: "state",
        header: "State",
        size: 100,
        cell: ({ row }) =>
          row.original.hidden ? (
            <span className={CELL}>
              <Badge
                variant="outline"
                className="font-normal text-muted-foreground"
                data-testid="plates-hidden-badge"
              >
                Hidden
              </Badge>
            </span>
          ) : (
            <span className={`${CELL} text-xs text-muted-foreground`}>
              Visible
            </span>
          ),
      },
    ];

    if (isOperator) {
      base.push({
        id: "actions",
        header: "",
        size: 150,
        cell: ({ row }) => (
          <span className={`${CELL} justify-end gap-1.5`}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onClone?.(row.original);
              }}
              data-testid="plate-clone-action"
            >
              <Copy className="size-3.5" />
              Clone
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onEdit?.(row.original);
              }}
              data-testid="plate-edit-action"
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
          </span>
        ),
      });
    }

    return base;
  }, [isOperator, onClone, onEdit]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <PlatesToolbarSearch table={filterTable} />
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
            tableClassName="table-fixed"
          />
        </div>
      )}
    </div>
  );
}

function PlatesToolbarSearch({
  table,
}: {
  table: ReturnType<typeof useReactTable<PlateFilterRow>>;
}) {
  const current = table
    .getState()
    .columnFilters.find((filter) => filter.id === FILTER_COLUMNS.search)?.value;
  const value =
    current &&
    typeof current === "object" &&
    "value" in current &&
    typeof (current as { value: unknown }).value === "string"
      ? ((current as { value: string }).value ?? "")
      : "";

  return (
    <div className="relative w-fit min-w-56 max-w-full">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search plates…"
        value={value}
        onChange={(event) => {
          const trimmed = event.target.value.trimStart();
          table
            .getColumn(FILTER_COLUMNS.search)
            ?.setFilterValue(
              trimmed ? { operator: "contains", value: trimmed } : undefined,
            );
        }}
        className="pl-9"
        data-testid="plates-search"
      />
    </div>
  );
}
