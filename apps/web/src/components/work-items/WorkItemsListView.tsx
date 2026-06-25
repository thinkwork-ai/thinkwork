import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Clock3,
  MessageSquareText,
  Minus,
  UserRound,
} from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DataTableTokenFilter,
  GroupedListView,
} from "@thinkwork/ui";
import { relativeTime } from "@/lib/utils";
import {
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  sortWorkItemStatuses,
  workItemDueLabel,
  workItemOwnerLabel,
  workItemPriorityLabel,
  workItemPriorityTone,
  workItemSourceLabel,
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemThreadCountLabel,
} from "./work-item-display";
import {
  WORK_ITEM_FILTER_COLUMN_VISIBILITY,
  buildWorkItemFilterColumnDefs,
  buildWorkItemTokenFilterColumns,
} from "./work-item-table-filter";
import { WorkItemListRow } from "./WorkItemListRow";
import { WorkItemStatusBadge } from "./WorkItemStatusBadge";
import { WorkItemStatusSelect } from "./WorkItemStatusSelect";
import {
  groupWorkItemsForDisplay,
  sortWorkItemsForDisplay,
  type WorkItemDisplayProperty,
  type WorkItemDisplayState,
} from "./work-item-view-display";

interface WorkItemsListViewProps {
  items: WorkItemSummary[];
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  display: WorkItemDisplayState["list"];
  includeSpace: boolean;
  updatingItemId?: string | null;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
}

export function WorkItemsListView({
  items,
  spaces,
  statuses,
  display,
  includeSpace,
  updatingItemId,
  onStatusChange,
}: WorkItemsListViewProps) {
  const sortedStatuses = useMemo(
    () => sortWorkItemStatuses(statuses),
    [statuses],
  );
  const tokenFilterColumns = useMemo(
    () => buildWorkItemTokenFilterColumns(spaces),
    [spaces],
  );
  const sortedItems = useMemo(
    () => sortWorkItemsForDisplay(items, display.sort, display.dir),
    [display.dir, display.sort, items],
  );
  const columns = useMemo<Array<ColumnDef<WorkItemSummary, unknown>>>(
    () =>
      buildListColumns({
        displayProperties: display.properties,
        includeSpace,
        onStatusChange,
        spaces,
        statuses: sortedStatuses,
        updatingItemId,
      }),
    [
      display.properties,
      includeSpace,
      onStatusChange,
      sortedStatuses,
      spaces,
      updatingItemId,
    ],
  );

  if (display.group !== "none" || display.subgroup !== "none") {
    const groups = groupWorkItemsForDisplay({
      items,
      spaces,
      statuses: sortedStatuses,
      group: display.group,
      subgroup: display.subgroup,
      sort: display.sort,
      dir: display.dir,
      showEmptyGroups: display.showEmptyGroups,
      showEmptySubgroups: display.showEmptySubgroups,
    });

    return (
      <GroupedListView
        groups={groups}
        getRowId={(item) => item.id}
        data-testid="work-items-list"
        className="min-h-0"
        rowClassName="px-3 py-2"
        emptyState={<EmptyWorkItemsState />}
        renderRow={(item) => (
          <WorkItemListRow
            item={item}
            spaces={spaces}
            statuses={sortedStatuses}
            properties={display.properties}
            includeSpace={includeSpace}
            updating={updatingItemId === item.id}
            onStatusChange={onStatusChange}
          />
        )}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={sortedItems}
      pageSize={0}
      scrollable
      allowHorizontalScroll={false}
      tableClassName="w-full table-fixed"
      emptyState={<EmptyWorkItemsState />}
      initialColumnVisibility={WORK_ITEM_FILTER_COLUMN_VISIBILITY}
      toolbar={(table) => (
        <DataTableTokenFilter
          table={table}
          columns={tokenFilterColumns}
          addLabel="Filter"
          clearLabel="Clear filters"
        />
      )}
    />
  );
}

function buildListColumns({
  displayProperties,
  includeSpace,
  onStatusChange,
  spaces,
  statuses,
  updatingItemId,
}: {
  displayProperties: WorkItemDisplayProperty[];
  includeSpace: boolean;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  updatingItemId?: string | null;
}): Array<ColumnDef<WorkItemSummary, unknown>> {
  const selected = new Set(displayProperties);
  const columns: Array<ColumnDef<WorkItemSummary, unknown> | false> = [
    ...buildWorkItemFilterColumnDefs(),
    {
      id: "title",
      header: "Work Item",
      accessorKey: "title",
      enableSorting: false,
      size: 320,
      meta: {
        cellClassName: "max-w-0",
      },
      cell: ({ row }) => (
        <WorkItemTitleCell
          item={row.original}
          spaces={spaces}
          showSpace={includeSpace && selected.has("space")}
          showOwner={selected.has("owner")}
          showUpdated={selected.has("updated")}
        />
      ),
    },
    selected.has("status") && {
      id: "status",
      header: "Status",
      enableSorting: false,
      size: 136,
      cell: ({ row }) => (
        <WorkItemStatusSelect
          item={row.original}
          statuses={statuses}
          disabled={updatingItemId === row.original.id}
          onChange={(status) => onStatusChange(row.original, status)}
        />
      ),
    },
    selected.has("priority") && {
      id: "priority",
      header: "Priority",
      accessorKey: "priority",
      enableSorting: false,
      size: 96,
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={`w-fit rounded-full text-xs ${workItemPriorityTone(
            row.original.priority,
          )}`}
        >
          {workItemPriorityLabel(row.original.priority)}
        </Badge>
      ),
    },
    selected.has("due") && {
      id: "due",
      header: "Due",
      accessorKey: "dueAt",
      enableSorting: false,
      size: 112,
      cell: ({ row }) => (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5 shrink-0" />
          <span className="truncate">
            {workItemDueLabel(row.original.dueAt)}
          </span>
        </span>
      ),
    },
    includeSpace &&
      selected.has("space") && {
        id: "space",
        header: "Space",
        enableSorting: false,
        size: 132,
        cell: ({ row }) => (
          <span className="truncate text-xs text-muted-foreground">
            {workItemSpaceLabel(row.original.spaceId, spaces)}
          </span>
        ),
      },
    selected.has("owner") && {
      id: "owner",
      header: "Owner",
      enableSorting: false,
      size: 132,
      cell: ({ row }) => (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <UserRound className="size-3.5 shrink-0" />
          <span className="truncate">{workItemOwnerLabel(row.original)}</span>
        </span>
      ),
    },
    selected.has("source") && {
      id: "source",
      header: "Source",
      enableSorting: false,
      size: 128,
      cell: ({ row }) => (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <MessageSquareText className="size-3.5 shrink-0" />
          <span className="truncate">{workItemSourceLabel(row.original)}</span>
        </span>
      ),
    },
    selected.has("created") && dateColumn("created", "Created", "createdAt"),
    selected.has("updated") && dateColumn("updated", "Updated", "updatedAt"),
    selected.has("completed") &&
      dateColumn("completed", "Completed", "completedAt"),
    selected.has("required") &&
      booleanColumn("required", "Required", (item) =>
        item.required ? "Required" : "Optional",
      ),
    selected.has("blocked") &&
      booleanColumn("blocked", "Blocked", (item) =>
        item.blocked ? "Blocked" : "Unblocked",
      ),
    selected.has("applicable") &&
      booleanColumn("applicable", "Applicable", (item) =>
        item.applicable ? "Applicable" : "Skipped",
      ),
    {
      id: "threads",
      header: "Threads",
      enableSorting: false,
      size: 96,
      cell: ({ row }) => <ThreadLinkCell item={row.original} />,
    },
  ];

  return columns.filter(Boolean) as Array<ColumnDef<WorkItemSummary, unknown>>;
}

function WorkItemTitleCell({
  item,
  spaces,
  showOwner,
  showSpace,
  showUpdated,
}: {
  item: WorkItemSummary;
  spaces: WorkItemSpaceSummary[];
  showOwner: boolean;
  showSpace: boolean;
  showUpdated: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot category={workItemStatusCategory(item)} />
        <h3 className="truncate text-sm font-semibold">{item.title}</h3>
        <WorkItemStatusBadge item={item} />
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {showSpace ? (
          <span className="truncate">
            {workItemSpaceLabel(item.spaceId, spaces)}
          </span>
        ) : null}
        {showOwner ? (
          <span className="truncate">{workItemOwnerLabel(item)}</span>
        ) : null}
        {showUpdated ? (
          <span className="truncate">
            Updated {item.updatedAt ? relativeTime(item.updatedAt) : "-"}
          </span>
        ) : null}
      </div>
      {item.notes ? (
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
          {item.notes}
        </p>
      ) : null}
    </div>
  );
}

function ThreadLinkCell({ item }: { item: WorkItemSummary }) {
  const primaryThreadId = item.threadLinks?.[0]?.threadId;

  if (!primaryThreadId) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3.5" />
        {workItemThreadCountLabel(item)}
      </span>
    );
  }

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="h-7 justify-start px-2 text-xs"
    >
      <Link to="/threads/$id" params={{ id: primaryThreadId }}>
        <MessageSquareText className="size-3.5" />
        <span>{workItemThreadCountLabel(item)}</span>
      </Link>
    </Button>
  );
}

function EmptyWorkItemsState() {
  return (
    <div className="flex min-h-48 items-center justify-center px-6 text-center">
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

function StatusDot({
  category,
}: {
  category: ReturnType<typeof workItemStatusCategory>;
}) {
  const tone =
    category === "DONE"
      ? "border-emerald-500 bg-emerald-500/15"
      : category === "BLOCKED"
        ? "border-rose-500 bg-rose-500/15"
        : category === "ACTIVE"
          ? "border-amber-500 bg-amber-500/15"
          : "border-sky-500 bg-sky-500/15";

  return <span className={`size-3 shrink-0 rounded-full border-2 ${tone}`} />;
}

function dateColumn(
  id: string,
  header: string,
  field: "createdAt" | "updatedAt" | "completedAt",
): ColumnDef<WorkItemSummary, unknown> {
  return {
    id,
    header,
    enableSorting: false,
    size: 116,
    cell: ({ row }) => (
      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {field === "completedAt" ? (
          <CheckCircle2 className="size-3.5 shrink-0" />
        ) : (
          <Clock3 className="size-3.5 shrink-0" />
        )}
        <span className="truncate">
          {row.original[field] ? relativeTime(row.original[field]) : "-"}
        </span>
      </span>
    ),
  };
}

function booleanColumn(
  id: string,
  header: string,
  label: (item: WorkItemSummary) => string,
): ColumnDef<WorkItemSummary, unknown> {
  return {
    id,
    header,
    enableSorting: false,
    size: 112,
    cell: ({ row }) => (
      <span className="truncate text-xs text-muted-foreground">
        {label(row.original)}
      </span>
    ),
  };
}
