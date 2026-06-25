import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  CalendarDays,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleSlash,
  Flag,
  Search,
  ShieldAlert,
  Sparkles,
  UserRound,
  Workflow,
} from "lucide-react";
import {
  dataTableTokenFilterFns,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";
import {
  WORK_ITEM_CATEGORY_ORDER,
  WORK_ITEM_PRIORITY_ORDER,
  type WorkItemSpaceSummary,
  type WorkItemSummary,
  isWorkItemDueSoon,
  workItemOwnerLabel,
  workItemPriorityLabel,
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
} from "./work-item-display";

export const WORK_ITEM_FILTER_COLUMNS = {
  search: "filterSearch",
  status: "filterStatus",
  priority: "filterPriority",
  due: "filterDue",
  required: "filterRequired",
  blocked: "filterBlocked",
  applicable: "filterApplicable",
  space: "filterSpace",
  owner: "filterOwner",
} as const;

export type WorkItemDueFilterValue = "overdue" | "due_soon" | "later" | "none";

export const WORK_ITEM_FILTER_COLUMN_VISIBILITY: VisibilityState =
  Object.fromEntries(
    Object.values(WORK_ITEM_FILTER_COLUMNS).map((columnId) => [
      columnId,
      false,
    ]),
  );

export function buildWorkItemTokenFilterColumns(
  spaces: WorkItemSpaceSummary[],
): DataTableTokenFilterColumn[] {
  return [
    {
      id: WORK_ITEM_FILTER_COLUMNS.search,
      label: "Search",
      type: "text",
      icon: <Search className="size-4" />,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.status,
      label: "Status",
      type: "option",
      icon: <CircleDotDashed className="size-4" />,
      options: WORK_ITEM_CATEGORY_ORDER.map((category) => ({
        value: category,
        label: workItemStatusCategoryLabel(category),
        icon: statusIcon(category),
      })),
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.priority,
      label: "Priority",
      type: "option",
      icon: <Flag className="size-4" />,
      options: WORK_ITEM_PRIORITY_ORDER.map((priority) => ({
        value: priority,
        label: workItemPriorityLabel(priority),
      })),
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.due,
      label: "Due",
      type: "option",
      icon: <CalendarDays className="size-4" />,
      options: [
        { value: "overdue", label: "Overdue" },
        { value: "due_soon", label: "Due soon" },
        { value: "later", label: "Later" },
        { value: "none", label: "No due date" },
      ],
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.required,
      label: "Required",
      type: "boolean",
      icon: <ShieldAlert className="size-4" />,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.blocked,
      label: "Blocked",
      type: "boolean",
      icon: <CircleAlert className="size-4" />,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.applicable,
      label: "Applicable",
      type: "boolean",
      icon: <Sparkles className="size-4" />,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.space,
      label: "Space",
      type: "option",
      icon: <Workflow className="size-4" />,
      options: spaces.map((space) => ({
        value: space.id,
        label: space.name?.trim() || "Space",
      })),
      emptyMessage: "No Spaces available.",
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.owner,
      label: "Owner",
      type: "text",
      icon: <UserRound className="size-4" />,
    },
  ];
}

export function buildWorkItemFilterColumnDefs(): Array<
  ColumnDef<WorkItemSummary, unknown>
> {
  return [
    {
      id: WORK_ITEM_FILTER_COLUMNS.search,
      accessorFn: workItemSearchFilterValue,
      filterFn: dataTableTokenFilterFns.text,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.status,
      accessorFn: (item) => workItemStatusCategory(item),
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.priority,
      accessorFn: (item) => item.priority,
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.due,
      accessorFn: (item) => workItemDueFilterValue(item),
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.required,
      accessorFn: (item) => item.required,
      filterFn: dataTableTokenFilterFns.boolean,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.blocked,
      accessorFn: (item) => item.blocked,
      filterFn: dataTableTokenFilterFns.boolean,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.applicable,
      accessorFn: (item) => item.applicable,
      filterFn: dataTableTokenFilterFns.boolean,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.space,
      accessorFn: (item) => item.spaceId,
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.owner,
      accessorFn: (item) => workItemOwnerLabel(item),
      filterFn: dataTableTokenFilterFns.text,
    },
  ];
}

export function workItemSearchFilterValue(item: WorkItemSummary) {
  return [
    item.title,
    item.notes,
    item.status?.name,
    workItemStatusCategoryLabel(workItemStatusCategory(item)),
    workItemPriorityLabel(item.priority),
    workItemOwnerLabel(item),
  ]
    .filter(Boolean)
    .join(" ");
}

export function workItemDueFilterValue(
  item: WorkItemSummary,
  now = new Date(),
): WorkItemDueFilterValue {
  if (!item.dueAt) return "none";
  const dueDate = new Date(item.dueAt);
  if (Number.isNaN(dueDate.getTime())) return "none";
  if (dueDate.getTime() < startOfToday(now).getTime()) return "overdue";
  return isWorkItemDueSoon(item.dueAt, now) ? "due_soon" : "later";
}

function statusIcon(category: (typeof WORK_ITEM_CATEGORY_ORDER)[number]) {
  if (category === "DONE") return <CircleCheck className="size-4" />;
  if (category === "BLOCKED") return <CircleAlert className="size-4" />;
  if (category === "SKIPPED") return <CircleSlash className="size-4" />;
  if (category === "ACTIVE") return <CircleDotDashed className="size-4" />;
  return <CircleDashed className="size-4" />;
}

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
