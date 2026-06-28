import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type Table as TanStackTable,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { CircleDashed, Search, X } from "lucide-react";
import {
  Button,
  DataTable,
  DataTableTokenFilter,
  GroupedListView,
  Input,
} from "@thinkwork/ui";
import {
  type WorkItemPriority,
  type WorkItemAssigneeSummary,
  type WorkItemLabelSummary,
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  buildWorkItemSequenceNumbers,
  isWorkItemOpen,
  sortWorkItemStatuses,
} from "./work-item-display";
import {
  WORK_ITEM_FILTER_COLUMNS,
  WORK_ITEM_FILTER_COLUMN_VISIBILITY,
  buildWorkItemFilterColumnDefs,
  buildWorkItemTokenFilterColumns,
} from "./work-item-table-filter";
import { WorkItemListRow } from "./WorkItemListRow";
import {
  groupWorkItemsForDisplay,
  sortWorkItemsForDisplay,
  type WorkItemDisplayProperty,
  type WorkItemDisplayState,
} from "./work-item-view-display";

const WORK_ITEM_LIST_PAGE_SIZE = 50;

interface WorkItemsListViewProps {
  items: WorkItemSummary[];
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  display: WorkItemDisplayState["list"];
  includeSpace: boolean;
  showDoneItems?: boolean;
  updatingItemId?: string | null;
  assignees?: WorkItemAssigneeSummary[];
  labels?: WorkItemLabelSummary[];
  currentUserId?: string | null;
  sequenceNumbers?: Map<string, number>;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
  onItemUpdate?: (
    item: WorkItemSummary,
    patch: {
      priority?: WorkItemPriority;
      dueAt?: string | null;
      ownerUserId?: string | null;
    },
  ) => void;
  onItemOpen?: (item: WorkItemSummary) => void;
}

export function WorkItemsListView({
  items,
  spaces,
  statuses,
  display,
  includeSpace,
  showDoneItems = false,
  updatingItemId,
  assignees = [],
  labels = [],
  currentUserId,
  sequenceNumbers,
  onStatusChange,
  onItemUpdate,
  onItemOpen,
}: WorkItemsListViewProps) {
  const sortedStatuses = useMemo(
    () => sortWorkItemStatuses(statuses),
    [statuses],
  );
  const tokenFilterColumns = useMemo(
    () =>
      buildWorkItemTokenFilterColumns(spaces, assignees, labels)
        .filter((column) => column.id !== WORK_ITEM_FILTER_COLUMNS.search)
        .sort((left, right) => left.label.localeCompare(right.label)),
    [assignees, labels, spaces],
  );
  const filterColumns = useMemo(
    () => buildWorkItemFilterColumnDefs(assignees),
    [assignees],
  );
  const sortedItems = useMemo(
    () => sortWorkItemsForDisplay(items, display.sort, display.dir),
    [display.dir, display.sort, items],
  );
  const sequenceNumberById = useMemo(
    () => sequenceNumbers ?? buildWorkItemSequenceNumbers(items),
    [items, sequenceNumbers],
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const defaultAssigneeFilterAppliedRef = useRef(false);

  useEffect(() => {
    if (!currentUserId || defaultAssigneeFilterAppliedRef.current) return;
    defaultAssigneeFilterAppliedRef.current = true;
    setColumnFilters((current) => {
      if (
        current.some((filter) => filter.id === WORK_ITEM_FILTER_COLUMNS.owner)
      ) {
        return current;
      }
      return [
        ...current,
        {
          id: WORK_ITEM_FILTER_COLUMNS.owner,
          value: { operator: "is_any_of", value: [currentUserId] },
        },
      ];
    });
  }, [currentUserId]);

  const filterTable = useReactTable({
    data: sortedItems,
    columns: filterColumns,
    autoResetPageIndex: false,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const filteredItems = filterTable
    .getFilteredRowModel()
    .rows.map((row) => row.original);
  const visibleItems = showDoneItems
    ? filteredItems
    : filteredItems.filter(isWorkItemOpen);
  const columns = useMemo<Array<ColumnDef<WorkItemSummary, unknown>>>(
    () =>
      buildListColumns({
        displayProperties: display.properties,
        assignees,
        includeSpace,
        labels,
        onItemUpdate,
        onItemOpen,
        onStatusChange,
        sequenceNumberById,
        spaces,
        statuses: sortedStatuses,
        updatingItemId,
      }),
    [
      display.properties,
      assignees,
      includeSpace,
      labels,
      onItemUpdate,
      onItemOpen,
      onStatusChange,
      sequenceNumberById,
      sortedStatuses,
      spaces,
      updatingItemId,
    ],
  );
  if (display.group !== "none" || display.subgroup !== "none") {
    const groups = groupWorkItemsForDisplay({
      items: visibleItems,
      spaces,
      statuses: sortedStatuses,
      group: display.group,
      subgroup: display.subgroup,
      sort: display.sort,
      dir: display.dir,
      showEmptyGroups: display.showEmptyGroups,
      showEmptySubgroups: display.showEmptySubgroups,
      assignees,
    });

    return (
      <div className="flex h-full min-h-0 flex-col">
        <WorkItemsListToolbar
          table={filterTable}
          tokenFilterColumns={tokenFilterColumns}
        />
        <div className="min-h-0 flex-1">
          <GroupedListView
            groups={groups}
            getRowId={(item) => item.id}
            data-testid="work-items-list"
            className="min-h-0"
            groupCountPlacement="inline"
            groupLabelClassName="text-foreground"
            groupCountClassName="text-muted-foreground"
            rowClassName="min-h-10 px-1 py-0"
            emptyState={<EmptyWorkItemsState />}
            renderRow={(item) => (
              <WorkItemListRow
                item={item}
                sequenceNumber={sequenceNumberById.get(item.id)}
                spaces={spaces}
                statuses={sortedStatuses}
                labels={labels}
                properties={display.properties}
                includeSpace={includeSpace}
                assignees={assignees}
                updating={updatingItemId === item.id}
                onStatusChange={onStatusChange}
                onItemUpdate={onItemUpdate}
                onItemOpen={onItemOpen}
              />
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkItemsListToolbar
        table={filterTable}
        tokenFilterColumns={tokenFilterColumns}
      />
      <div className="min-h-0 flex-1">
        <DataTable
          columns={columns}
          data={visibleItems}
          pageSize={WORK_ITEM_LIST_PAGE_SIZE}
          scrollable
          allowHorizontalScroll={false}
          hideHeader
          tableClassName="w-full table-fixed"
          emptyState={<EmptyWorkItemsState />}
          emptyStatePlacement="container"
          initialColumnVisibility={WORK_ITEM_FILTER_COLUMN_VISIBILITY}
        />
      </div>
    </div>
  );
}

function WorkItemsListToolbar({
  table,
  tokenFilterColumns,
}: {
  table: TanStackTable<WorkItemSummary>;
  tokenFilterColumns: ReturnType<typeof buildWorkItemTokenFilterColumns>;
}) {
  return (
    <div className="mb-3 flex shrink-0 items-center pt-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <WorkItemsToolbarSearch table={table} />
        <DataTableTokenFilter
          table={table}
          columns={tokenFilterColumns.filter(
            (column) =>
              column.id !== WORK_ITEM_FILTER_COLUMNS.required &&
              column.id !== WORK_ITEM_FILTER_COLUMNS.blocked &&
              column.id !== WORK_ITEM_FILTER_COLUMNS.applicable,
          )}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full [&_[data-token-filter-token]]:shrink-0"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
      </div>
    </div>
  );
}

function WorkItemsToolbarSearch({
  table,
}: {
  table: TanStackTable<WorkItemSummary>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const searchFilter = table
    .getState()
    .columnFilters.find(
      (filter) => filter.id === WORK_ITEM_FILTER_COLUMNS.search,
    )?.value;
  const searchValue =
    isTextFilterValue(searchFilter) && typeof searchFilter.value === "string"
      ? searchFilter.value
      : "";
  const isOpen = expanded || searchValue.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const setSearchValue = (value: string) => {
    const trimmed = value.trimStart();

    table.getColumn(WORK_ITEM_FILTER_COLUMNS.search)?.setFilterValue(
      trimmed
        ? {
            operator: "contains",
            value: trimmed,
          }
        : undefined,
    );
    table.setPageIndex(0);
  };

  const clearSearch = () => {
    setSearchValue("");
    setExpanded(false);
  };

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-8 w-8 rounded-md"
        aria-label="Search work items"
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(16rem,calc(100vw-2rem))] items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        aria-label="Search work items"
        placeholder="Search work items..."
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={searchValue}
        onBlur={() => {
          if (!searchValue) setExpanded(false);
        }}
        onChange={(event) => setSearchValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            clearSearch();
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Clear work item search"
        onMouseDown={(event) => event.preventDefault()}
        onClick={clearSearch}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

function isTextFilterValue(
  value: unknown,
): value is { operator: "contains"; value: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { operator?: unknown }).operator === "contains" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

function buildListColumns({
  displayProperties,
  assignees,
  includeSpace,
  labels,
  onItemUpdate,
  onItemOpen,
  onStatusChange,
  sequenceNumberById,
  spaces,
  statuses,
  updatingItemId,
}: {
  displayProperties: WorkItemDisplayProperty[];
  assignees: WorkItemAssigneeSummary[];
  includeSpace: boolean;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
  onItemUpdate?: (
    item: WorkItemSummary,
    patch: {
      priority?: WorkItemPriority;
      dueAt?: string | null;
      ownerUserId?: string | null;
      labelIds?: string[];
    },
  ) => void;
  onItemOpen?: (item: WorkItemSummary) => void;
  sequenceNumberById: Map<string, number>;
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  labels: WorkItemLabelSummary[];
  updatingItemId?: string | null;
}): Array<ColumnDef<WorkItemSummary, unknown>> {
  const columns: Array<ColumnDef<WorkItemSummary, unknown> | false> = [
    ...buildWorkItemFilterColumnDefs(assignees),
    {
      id: "item",
      header: "",
      accessorKey: "title",
      enableSorting: false,
      meta: {
        cellClassName: "max-w-0 px-1",
      },
      cell: ({ row }) => (
        <WorkItemListRow
          item={row.original}
          sequenceNumber={sequenceNumberById.get(row.original.id)}
          spaces={spaces}
          statuses={statuses}
          labels={labels}
          properties={displayProperties}
          includeSpace={includeSpace}
          assignees={assignees}
          updating={updatingItemId === row.original.id}
          onStatusChange={onStatusChange}
          onItemUpdate={onItemUpdate}
          onItemOpen={onItemOpen}
        />
      ),
    },
  ];

  return columns.filter(Boolean) as Array<ColumnDef<WorkItemSummary, unknown>>;
}

function EmptyWorkItemsState() {
  return (
    <div
      className="flex min-h-80 items-center justify-center px-6 text-center"
      data-testid="work-items-list-empty"
    >
      <div className="max-w-sm">
        <CircleDashed className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h2 className="text-sm font-semibold">No work items in this view</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Change the filters or adjust Display to inspect active work.
        </p>
      </div>
    </div>
  );
}
