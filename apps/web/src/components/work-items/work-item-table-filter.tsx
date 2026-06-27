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
  Tags,
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
  type WorkItemAssigneeSummary,
  type WorkItemLabelSummary,
  type WorkItemSpaceSummary,
  type WorkItemSummary,
  isWorkItemDueSoon,
  workItemAssigneeColorClass,
  workItemAssigneeLabel,
  workItemLabels,
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
  label: "filterLabel",
} as const;

export type WorkItemDueFilterValue = "overdue" | "due_soon" | "later" | "none";
export const WORK_ITEM_UNASSIGNED_FILTER_VALUE = "__unassigned__";

export const WORK_ITEM_FILTER_COLUMN_VISIBILITY: VisibilityState =
  Object.fromEntries(
    Object.values(WORK_ITEM_FILTER_COLUMNS).map((columnId) => [
      columnId,
      false,
    ]),
  );

export function buildWorkItemTokenFilterColumns(
  spaces: WorkItemSpaceSummary[],
  assignees: WorkItemAssigneeSummary[] = [],
  labels: WorkItemLabelSummary[] = [],
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
      id: WORK_ITEM_FILTER_COLUMNS.label,
      label: "Label",
      type: "option",
      icon: <Tags className="size-4" />,
      options: labels.map((label) => ({
        value: label.slug,
        label: label.name,
        icon: (
          <span
            className="inline-flex size-2.5 rounded-full"
            style={{ backgroundColor: label.color ?? "#64748b" }}
          />
        ),
      })),
      emptyMessage: "No labels available.",
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.owner,
      label: "Assignee",
      type: "option",
      icon: <UserRound className="size-4" />,
      options: [
        {
          value: WORK_ITEM_UNASSIGNED_FILTER_VALUE,
          label: "Unassigned",
          icon: (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="size-3" />
            </span>
          ),
        },
        ...assignees.map((assignee) => ({
          value: assignee.id,
          label: assignee.name?.trim() || assignee.email || "Assignee",
          icon: (
            <span
              className={`inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ${workItemAssigneeColorClass(
                assignee.id,
              )}`}
            >
              {assigneeInitials(assignee.name || assignee.email || "User")}
            </span>
          ),
        })),
      ],
      emptyMessage: "No team members available.",
    },
  ];
}

export function buildWorkItemFilterColumnDefs(
  assignees: WorkItemAssigneeSummary[] = [],
): Array<ColumnDef<WorkItemSummary, unknown>> {
  return [
    {
      id: WORK_ITEM_FILTER_COLUMNS.search,
      accessorFn: (item) => workItemSearchFilterValue(item, assignees),
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
      accessorFn: (item) =>
        item.ownerUserId ?? WORK_ITEM_UNASSIGNED_FILTER_VALUE,
      filterFn: dataTableTokenFilterFns.option,
    },
    {
      id: WORK_ITEM_FILTER_COLUMNS.label,
      accessorFn: (item) => workItemLabels(item).map((label) => label.slug),
      filterFn: workItemLabelFilterFn,
    },
  ];
}

export function workItemSearchFilterValue(
  item: WorkItemSummary,
  assignees: WorkItemAssigneeSummary[] = [],
) {
  return [
    item.title,
    item.notes,
    item.status?.name,
    workItemStatusCategoryLabel(workItemStatusCategory(item)),
    workItemPriorityLabel(item.priority),
    workItemAssigneeLabel(item, assignees),
    workItemLabels(item)
      .map((label) => label.name)
      .join(" "),
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

function assigneeInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length >= 2
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : value.slice(0, 2);
  return letters.toUpperCase();
}

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function workItemLabelFilterFn(
  row: { getValue: (columnId: string) => unknown },
  columnId: string,
  filterValue: unknown,
) {
  if (!isOptionFilterValue(filterValue)) return true;
  const rowValues = row.getValue(columnId);
  const labelSlugs = Array.isArray(rowValues)
    ? rowValues.map((value) => String(value))
    : [String(rowValues ?? "")];
  const selected = filterValueList(filterValue.value);
  if (selected.length === 0) return true;
  const hasMatch = selected.some((value) => labelSlugs.includes(value));
  return filterValue.operator === "is_any_of" || filterValue.operator === "is"
    ? hasMatch
    : !hasMatch;
}

function isOptionFilterValue(value: unknown): value is {
  operator: "is" | "is_not" | "is_any_of" | "is_none_of";
  value: string | string[];
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { operator?: unknown; value?: unknown };
  return (
    typeof candidate.operator === "string" &&
    ["is", "is_not", "is_any_of", "is_none_of"].includes(candidate.operator) &&
    (typeof candidate.value === "string" || Array.isArray(candidate.value))
  );
}

function filterValueList(value: string | string[]) {
  return (Array.isArray(value) ? value : [value])
    .map((entry) => String(entry))
    .filter(Boolean);
}
