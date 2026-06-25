import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CalendarDays,
  CircleDashed,
  MessageSquareText,
  Minus,
} from "lucide-react";
import { Badge, Button, DataTable, DataTableTokenFilter } from "@thinkwork/ui";
import { relativeTime } from "@/lib/utils";
import {
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemDueLabel,
  workItemOwnerLabel,
  workItemPriorityLabel,
  workItemPriorityTone,
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemThreadCountLabel,
} from "./work-item-display";
import {
  WORK_ITEM_FILTER_COLUMN_VISIBILITY,
  buildWorkItemFilterColumnDefs,
  buildWorkItemTokenFilterColumns,
} from "./work-item-table-filter";
import { WorkItemStatusSelect } from "./WorkItemStatusSelect";

interface WorkItemsListViewProps {
  items: WorkItemSummary[];
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
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
  updatingItemId,
  onStatusChange,
}: WorkItemsListViewProps) {
  const tokenFilterColumns = useMemo(
    () => buildWorkItemTokenFilterColumns(spaces),
    [spaces],
  );
  const columns = useMemo<Array<ColumnDef<WorkItemSummary, unknown>>>(
    () => [
      ...buildWorkItemFilterColumnDefs(),
      {
        id: "title",
        header: "Work Item",
        accessorKey: "title",
        enableSorting: false,
        size: 360,
        meta: {
          cellClassName: "max-w-0",
        },
        cell: ({ row }) => (
          <WorkItemTitleCell item={row.original} spaces={spaces} />
        ),
      },
      {
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
      {
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
      {
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
      {
        id: "threads",
        header: "Threads",
        enableSorting: false,
        size: 96,
        cell: ({ row }) => <ThreadLinkCell item={row.original} />,
      },
    ],
    [onStatusChange, spaces, statuses, updatingItemId],
  );

  return (
    <DataTable
      columns={columns}
      data={items}
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

function WorkItemTitleCell({
  item,
  spaces,
}: {
  item: WorkItemSummary;
  spaces: WorkItemSpaceSummary[];
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot category={workItemStatusCategory(item)} />
        <h3 className="truncate text-sm font-semibold">{item.title}</h3>
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="truncate">
          {workItemSpaceLabel(item.spaceId, spaces)}
        </span>
        <span className="truncate">{workItemOwnerLabel(item)}</span>
        <span className="truncate">
          Updated {item.updatedAt ? relativeTime(item.updatedAt) : "-"}
        </span>
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
          Change the filters to inspect active work.
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
