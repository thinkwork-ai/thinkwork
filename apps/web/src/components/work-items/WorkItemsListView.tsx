import { Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { MessageSquareText } from "lucide-react";
import { useMemo } from "react";
import { Badge, Button, DataTable } from "@thinkwork/ui";
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
  workItemThreadCountLabel,
} from "./work-item-display";
import { WorkItemStatusSelect } from "./WorkItemStatusSelect";

const CELL = "flex h-10 min-w-0 items-center px-2";

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
  includeSpace,
  updatingItemId,
  onStatusChange,
}: WorkItemsListViewProps) {
  const columns = useMemo(
    () =>
      workItemColumns({
        spaces,
        statuses,
        includeSpace,
        updatingItemId,
        onStatusChange,
      }),
    [includeSpace, onStatusChange, spaces, statuses, updatingItemId],
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      scrollable
      tableClassName="min-w-[64rem] table-fixed"
      pageSize={25}
      emptyState="No Work Items match this view."
    />
  );
}

function workItemColumns({
  spaces,
  statuses,
  includeSpace,
  updatingItemId,
  onStatusChange,
}: {
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  includeSpace: boolean;
  updatingItemId?: string | null;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
}): ColumnDef<WorkItemSummary>[] {
  return [
    {
      accessorKey: "title",
      header: "Work Item",
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div
            className={`${CELL} flex-col items-start justify-center gap-0.5`}
          >
            <span className="max-w-full truncate text-sm font-medium">
              {item.title}
            </span>
            <span className="max-w-full truncate text-xs text-muted-foreground">
              {item.notes || "No notes"}
            </span>
          </div>
        );
      },
    },
    ...(includeSpace
      ? [
          {
            id: "space",
            header: "Space",
            size: 160,
            cell: ({ row }) => (
              <span className={`${CELL} text-xs text-muted-foreground`}>
                <span className="truncate">
                  {workItemSpaceLabel(row.original.spaceId, spaces)}
                </span>
              </span>
            ),
          } as ColumnDef<WorkItemSummary>,
        ]
      : []),
    {
      id: "status",
      header: "Status",
      size: 160,
      cell: ({ row }) => (
        <span className={CELL}>
          <WorkItemStatusSelect
            item={row.original}
            statuses={statuses}
            disabled={updatingItemId === row.original.id}
            onChange={(status) => onStatusChange(row.original, status)}
          />
        </span>
      ),
    },
    {
      accessorKey: "priority",
      header: "Priority",
      size: 104,
      cell: ({ row }) => (
        <span className={CELL}>
          <Badge
            variant="secondary"
            className={`rounded-full text-xs ${workItemPriorityTone(
              row.original.priority,
            )}`}
          >
            {workItemPriorityLabel(row.original.priority)}
          </Badge>
        </span>
      ),
    },
    {
      accessorKey: "dueAt",
      header: "Due",
      size: 120,
      cell: ({ row }) => (
        <span className={`${CELL} text-xs text-muted-foreground`}>
          <span className="truncate">
            {workItemDueLabel(row.original.dueAt)}
          </span>
        </span>
      ),
    },
    {
      id: "owner",
      header: "Owner",
      size: 130,
      cell: ({ row }) => (
        <span className={`${CELL} text-xs text-muted-foreground`}>
          <span className="truncate">{workItemOwnerLabel(row.original)}</span>
        </span>
      ),
    },
    {
      id: "threads",
      header: "Threads",
      size: 110,
      cell: ({ row }) => {
        const primaryThreadId = row.original.threadLinks?.[0]?.threadId;
        if (!primaryThreadId) {
          return (
            <span className={`${CELL} text-xs text-muted-foreground`}>
              {workItemThreadCountLabel(row.original)}
            </span>
          );
        }
        return (
          <span className={CELL}>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
            >
              <Link to="/threads/$id" params={{ id: primaryThreadId }}>
                <MessageSquareText className="size-3.5" />
                <span>{workItemThreadCountLabel(row.original)}</span>
              </Link>
            </Button>
          </span>
        );
      },
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      size: 112,
      cell: ({ row }) => (
        <span className={`${CELL} text-xs text-muted-foreground`}>
          {row.original.updatedAt ? relativeTime(row.original.updatedAt) : "-"}
        </span>
      ),
    },
  ];
}
