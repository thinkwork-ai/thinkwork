import type { GroupedListGroup } from "@thinkwork/ui";
import {
  WORK_ITEM_CATEGORY_ORDER,
  WORK_ITEM_PRIORITY_ORDER,
  isWorkItemDueSoon,
  type WorkItemPriority,
  type WorkItemAssigneeSummary,
  type WorkItemSpaceSummary,
  type WorkItemStatusCategory,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemDueLabel,
  workItemAssigneeLabel,
  workItemPriorityLabel,
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
  workItemStatusLabel,
  workItemSourceLabel,
} from "./work-item-display";

export type WorkItemDisplayView = "list" | "board";
export type WorkItemDisplayGroup =
  | "none"
  | "status"
  | "priority"
  | "owner"
  | "space"
  | "dueState"
  | "required"
  | "blocked"
  | "applicable"
  | "source";
export type WorkItemBoardColumn = Exclude<WorkItemDisplayGroup, "none">;
export type WorkItemDisplaySort =
  | "updated"
  | "created"
  | "due"
  | "priority"
  | "title"
  | "completed";
export type WorkItemDisplayDirection = "asc" | "desc";
export type WorkItemDisplayProperty =
  | "status"
  | "priority"
  | "owner"
  | "due"
  | "space"
  | "source"
  | "created"
  | "updated"
  | "completed"
  | "required"
  | "blocked"
  | "applicable";

export interface WorkItemDisplayState {
  view: WorkItemDisplayView;
  list: {
    group: WorkItemDisplayGroup;
    subgroup: WorkItemDisplayGroup;
    sort: WorkItemDisplaySort;
    dir: WorkItemDisplayDirection;
    showEmptyGroups: boolean;
    showEmptySubgroups: boolean;
    properties: WorkItemDisplayProperty[];
  };
  board: {
    column: WorkItemBoardColumn;
    row: WorkItemDisplayGroup;
    subgroup: WorkItemDisplayGroup;
    sort: WorkItemDisplaySort;
    dir: WorkItemDisplayDirection;
    showEmptyColumns: boolean;
    showEmptyRows: boolean;
    properties: WorkItemDisplayProperty[];
  };
}

export interface WorkItemDisplayRouteFields {
  view?: WorkItemDisplayView;
  listGroup?: WorkItemDisplayGroup;
  listSubgroup?: WorkItemDisplayGroup;
  listSort?: WorkItemDisplaySort;
  listDir?: WorkItemDisplayDirection;
  listShowEmptyGroups?: boolean;
  listShowEmptySubgroups?: boolean;
  listProps?: WorkItemDisplayProperty[];
  boardColumn?: WorkItemBoardColumn;
  boardRow?: WorkItemDisplayGroup;
  boardSubgroup?: WorkItemDisplayGroup;
  boardSort?: WorkItemDisplaySort;
  boardDir?: WorkItemDisplayDirection;
  boardShowEmptyColumns?: boolean;
  boardShowEmptyRows?: boolean;
  boardProps?: WorkItemDisplayProperty[];
}

export interface WorkItemDisplayOption<Value extends string = string> {
  value: Value;
  label: string;
}

export const WORK_ITEM_GROUP_OPTIONS = [
  { value: "none", label: "No grouping" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "owner", label: "Assignee" },
  { value: "space", label: "Space" },
  { value: "dueState", label: "Due state" },
  { value: "required", label: "Required" },
  { value: "blocked", label: "Blocked" },
  { value: "applicable", label: "Applicability" },
  { value: "source", label: "Source" },
] satisfies WorkItemDisplayOption<WorkItemDisplayGroup>[];

export const WORK_ITEM_BOARD_COLUMN_OPTIONS = WORK_ITEM_GROUP_OPTIONS.filter(
  (option): option is WorkItemDisplayOption<WorkItemBoardColumn> =>
    option.value !== "none",
);

export const WORK_ITEM_SORT_OPTIONS = [
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "title", label: "Title" },
  { value: "completed", label: "Completed" },
] satisfies WorkItemDisplayOption<WorkItemDisplaySort>[];

export const WORK_ITEM_PROPERTY_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "owner", label: "Assignee" },
  { value: "due", label: "Due date" },
  { value: "space", label: "Space" },
  { value: "source", label: "Source" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "completed", label: "Completed" },
  { value: "required", label: "Required" },
  { value: "blocked", label: "Blocked" },
  { value: "applicable", label: "Applicable" },
] satisfies WorkItemDisplayOption<WorkItemDisplayProperty>[];

export const DEFAULT_WORK_ITEM_DISPLAY_STATE: WorkItemDisplayState = {
  view: "list",
  list: {
    group: "none",
    subgroup: "none",
    sort: "priority",
    dir: "asc",
    showEmptyGroups: false,
    showEmptySubgroups: false,
    properties: ["status", "priority", "owner", "due", "space", "source"],
  },
  board: {
    column: "status",
    row: "none",
    subgroup: "none",
    sort: "updated",
    dir: "desc",
    showEmptyColumns: true,
    showEmptyRows: false,
    properties: ["priority", "owner", "due", "space", "source"],
  },
};

const groupValues = new Set(
  WORK_ITEM_GROUP_OPTIONS.map((option) => option.value),
);
const boardColumnValues = new Set(
  WORK_ITEM_BOARD_COLUMN_OPTIONS.map((option) => option.value),
);
const sortValues = new Set(
  WORK_ITEM_SORT_OPTIONS.map((option) => option.value),
);
const propertyValues = new Set(
  WORK_ITEM_PROPERTY_OPTIONS.map((option) => option.value),
);

export function normalizeWorkItemDisplayState(
  search: Record<string, unknown>,
): WorkItemDisplayState {
  const legacySort = parseSort(search.sort);
  const listGroup = parseGroup(search.listGroup);
  const listSubgroup = normalizeSubgroup(
    parseGroup(search.listSubgroup),
    listGroup,
  );
  const boardColumn = parseBoardColumn(search.boardColumn);
  const boardRow = normalizeSubgroup(parseGroup(search.boardRow), boardColumn);
  const boardSubgroup = normalizeSubgroup(
    parseGroup(search.boardSubgroup),
    boardRow,
    boardColumn,
  );

  return {
    view: search.view === "board" ? "board" : "list",
    list: {
      group: listGroup,
      subgroup: listSubgroup,
      sort:
        parseSort(search.listSort) ??
        legacySort ??
        DEFAULT_WORK_ITEM_DISPLAY_STATE.list.sort,
      dir: parseDirection(
        search.listDir,
        DEFAULT_WORK_ITEM_DISPLAY_STATE.list.dir,
      ),
      showEmptyGroups: booleanParam(search.listShowEmptyGroups) ?? false,
      showEmptySubgroups: booleanParam(search.listShowEmptySubgroups) ?? false,
      properties: parseProperties(
        search.listProps,
        DEFAULT_WORK_ITEM_DISPLAY_STATE.list.properties,
      ),
    },
    board: {
      column: boardColumn,
      row: boardRow,
      subgroup: boardSubgroup,
      sort:
        parseSort(search.boardSort) ??
        legacySort ??
        DEFAULT_WORK_ITEM_DISPLAY_STATE.board.sort,
      dir: parseDirection(
        search.boardDir,
        DEFAULT_WORK_ITEM_DISPLAY_STATE.board.dir,
      ),
      showEmptyColumns: booleanParam(search.boardShowEmptyColumns) ?? true,
      showEmptyRows: booleanParam(search.boardShowEmptyRows) ?? false,
      properties: parseProperties(
        search.boardProps,
        DEFAULT_WORK_ITEM_DISPLAY_STATE.board.properties,
      ),
    },
  };
}

export function workItemDisplayStateToParams(state: WorkItemDisplayState) {
  const defaults = DEFAULT_WORK_ITEM_DISPLAY_STATE;
  const params: Record<string, string | boolean | undefined> = {
    view: state.view === defaults.view ? undefined : state.view,
    listGroup:
      state.list.group === defaults.list.group ? undefined : state.list.group,
    listSubgroup:
      state.list.subgroup === defaults.list.subgroup
        ? undefined
        : state.list.subgroup,
    listSort:
      state.list.sort === defaults.list.sort ? undefined : state.list.sort,
    listDir: state.list.dir === defaults.list.dir ? undefined : state.list.dir,
    listShowEmptyGroups:
      state.list.showEmptyGroups === defaults.list.showEmptyGroups
        ? undefined
        : state.list.showEmptyGroups,
    listShowEmptySubgroups:
      state.list.showEmptySubgroups === defaults.list.showEmptySubgroups
        ? undefined
        : state.list.showEmptySubgroups,
    listProps: sameArray(state.list.properties, defaults.list.properties)
      ? undefined
      : state.list.properties.join(","),
    boardColumn:
      state.board.column === defaults.board.column
        ? undefined
        : state.board.column,
    boardRow:
      state.board.row === defaults.board.row ? undefined : state.board.row,
    boardSubgroup:
      state.board.subgroup === defaults.board.subgroup
        ? undefined
        : state.board.subgroup,
    boardSort:
      state.board.sort === defaults.board.sort ? undefined : state.board.sort,
    boardDir:
      state.board.dir === defaults.board.dir ? undefined : state.board.dir,
    boardShowEmptyColumns:
      state.board.showEmptyColumns === defaults.board.showEmptyColumns
        ? undefined
        : state.board.showEmptyColumns,
    boardShowEmptyRows:
      state.board.showEmptyRows === defaults.board.showEmptyRows
        ? undefined
        : state.board.showEmptyRows,
    boardProps: sameArray(state.board.properties, defaults.board.properties)
      ? undefined
      : state.board.properties.join(","),
  };
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  );
}

export function sortWorkItemsForDisplay(
  items: WorkItemSummary[],
  sort: WorkItemDisplaySort,
  dir: WorkItemDisplayDirection,
) {
  return [...items].sort((left, right) => {
    const delta = compareWorkItems(left, right, sort);
    return dir === "asc" ? delta : -delta;
  });
}

export function groupWorkItemsForDisplay({
  items,
  group,
  subgroup,
  sort,
  dir,
  showEmptyGroups,
  showEmptySubgroups,
  spaces,
  statuses,
  assignees = [],
}: {
  items: WorkItemSummary[];
  group: WorkItemDisplayGroup;
  subgroup: WorkItemDisplayGroup;
  sort: WorkItemDisplaySort;
  dir: WorkItemDisplayDirection;
  showEmptyGroups: boolean;
  showEmptySubgroups: boolean;
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  assignees?: WorkItemAssigneeSummary[];
}): GroupedListGroup<WorkItemSummary>[] {
  const sortedItems = sortWorkItemsForDisplay(items, sort, dir);
  if (group === "none") {
    return [{ id: "all", label: "All Work Items", rows: sortedItems }];
  }

  return orderBuckets(
    groupBuckets(
      group,
      items,
      spaces,
      statuses,
      showEmptyGroups,
      assignees,
    ),
  )
    .map((bucket) => {
      const bucketItems = sortedItems.filter((item) => bucket.matches(item));
      const subgroups =
        subgroup === "none"
          ? undefined
          : orderBuckets(
              groupBuckets(
                subgroup,
                bucketItems,
                spaces,
                statuses,
                showEmptySubgroups,
                assignees,
              ),
            )
              .map((subBucket) => ({
                id: subBucket.id,
                label: subBucket.label,
                rows: bucketItems.filter((item) => subBucket.matches(item)),
              }))
              .filter(
                (subBucket) => subBucket.rows.length > 0 || showEmptySubgroups,
              );

      return {
        id: bucket.id,
        label: bucket.label,
        rows: subgroups ? [] : bucketItems,
        subgroups,
      };
    })
    .filter((bucket) => countGroupRows(bucket) > 0 || showEmptyGroups);
}

export function workItemPropertyLabel(property: WorkItemDisplayProperty) {
  return (
    WORK_ITEM_PROPERTY_OPTIONS.find((option) => option.value === property)
      ?.label ?? property
  );
}

export function dueStateLabel(item: WorkItemSummary) {
  if (!item.dueAt) return "No due date";
  const due = new Date(item.dueAt);
  if (Number.isNaN(due.getTime())) return "No due date";
  const today = startOfToday(new Date());
  if (due < today) return "Overdue";
  if (isWorkItemDueSoon(item.dueAt)) return "Due soon";
  return "Later";
}

function parseGroup(value: unknown): WorkItemDisplayGroup {
  return typeof value === "string" &&
    groupValues.has(value as WorkItemDisplayGroup)
    ? (value as WorkItemDisplayGroup)
    : "none";
}

function parseBoardColumn(value: unknown): WorkItemBoardColumn {
  return typeof value === "string" &&
    boardColumnValues.has(value as WorkItemBoardColumn)
    ? (value as WorkItemBoardColumn)
    : "status";
}

function parseSort(value: unknown): WorkItemDisplaySort | undefined {
  return typeof value === "string" &&
    sortValues.has(value as WorkItemDisplaySort)
    ? (value as WorkItemDisplaySort)
    : undefined;
}

function parseDirection(
  value: unknown,
  fallback: WorkItemDisplayDirection,
): WorkItemDisplayDirection {
  if (value === "asc") return "asc";
  if (value === "desc") return "desc";
  return fallback;
}

function normalizeSubgroup(
  subgroup: WorkItemDisplayGroup,
  ...parents: (WorkItemDisplayGroup | WorkItemBoardColumn)[]
): WorkItemDisplayGroup {
  if (subgroup === "none") return "none";
  return parents.includes(subgroup) || parents.includes("none")
    ? "none"
    : subgroup;
}

function parseProperties(
  value: unknown,
  defaults: WorkItemDisplayProperty[],
): WorkItemDisplayProperty[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const parsed = raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is WorkItemDisplayProperty =>
      propertyValues.has(entry as WorkItemDisplayProperty),
    );
  const unique = Array.from(new Set(parsed));
  return unique.length > 0 ? unique : defaults;
}

function booleanParam(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function sameArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function compareWorkItems(
  left: WorkItemSummary,
  right: WorkItemSummary,
  sort: WorkItemDisplaySort,
) {
  if (sort === "title") return left.title.localeCompare(right.title);
  if (sort === "priority") {
    const priorityDelta =
      WORK_ITEM_PRIORITY_ORDER.indexOf(left.priority) -
      WORK_ITEM_PRIORITY_ORDER.indexOf(right.priority);
    if (priorityDelta !== 0) return priorityDelta;
    return compareDates(right.createdAt, left.createdAt);
  }
  if (sort === "due") {
    return compareDates(left.dueAt, right.dueAt);
  }
  if (sort === "created") {
    return compareDates(left.createdAt, right.createdAt);
  }
  if (sort === "completed") {
    return compareDates(left.completedAt, right.completedAt);
  }
  return compareDates(left.updatedAt, right.updatedAt);
}

function compareDates(left?: string | null, right?: string | null) {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return (
    (Number.isNaN(leftTime) ? 0 : leftTime) -
    (Number.isNaN(rightTime) ? 0 : rightTime)
  );
}

interface Bucket {
  id: string;
  label: string;
  rank: number;
  matches: (item: WorkItemSummary) => boolean;
}

function groupBuckets(
  group: WorkItemDisplayGroup,
  items: WorkItemSummary[],
  spaces: WorkItemSpaceSummary[],
  statuses: WorkItemStatusSummary[],
  includeEmpty: boolean,
  assignees: WorkItemAssigneeSummary[] = [],
): Bucket[] {
  if (group === "status") {
    const statusBuckets = statuses.length
      ? statuses.map((status) => ({
          id: `status:${status.id}`,
          label: status.name || workItemStatusCategoryLabel(status.category),
          rank: statusBucketRank(status.category, status.displayOrder),
          matches: (item: WorkItemSummary) =>
            status.spaceId && item.status?.id
              ? item.status.id === status.id
              : workItemStatusCategory(item) === status.category,
        }))
      : WORK_ITEM_CATEGORY_ORDER.map((category) => ({
          id: `status:${category}`,
          label: workItemStatusCategoryLabel(category),
          rank: statusBucketRank(category),
          matches: (item: WorkItemSummary) =>
            workItemStatusCategory(item) === category,
        }));
    return statusBuckets;
  }

  if (group === "priority") {
    return WORK_ITEM_PRIORITY_ORDER.map((priority) => ({
      id: `priority:${priority}`,
      label: workItemPriorityLabel(priority),
      rank: WORK_ITEM_PRIORITY_ORDER.indexOf(priority),
      matches: (item) => item.priority === priority,
    }));
  }

  if (group === "space") {
    const buckets = spaces.map((space) => ({
      id: `space:${space.id}`,
      label: space.name?.trim() || "Space",
      rank: 0,
      matches: (item: WorkItemSummary) => item.spaceId === space.id,
    }));
    const missingSpaces = items
      .filter((item) => !spaces.some((space) => space.id === item.spaceId))
      .map((item) => item.spaceId);
    return [
      ...buckets,
      ...Array.from(new Set(missingSpaces)).map((spaceId) => ({
        id: `space:${spaceId}`,
        label: workItemSpaceLabel(spaceId, spaces),
        rank: 0,
        matches: (item: WorkItemSummary) => item.spaceId === spaceId,
      })),
    ];
  }

  if (group === "dueState") {
    return [
      {
        id: "due:overdue",
        label: "Overdue",
        rank: 0,
        matches: (item) => dueStateLabel(item) === "Overdue",
      },
      {
        id: "due:soon",
        label: "Due soon",
        rank: 1,
        matches: (item) => dueStateLabel(item) === "Due soon",
      },
      {
        id: "due:later",
        label: "Later",
        rank: 2,
        matches: (item) => dueStateLabel(item) === "Later",
      },
      {
        id: "due:none",
        label: "No due date",
        rank: 3,
        matches: (item) => dueStateLabel(item) === "No due date",
      },
    ];
  }

  if (group === "required") {
    return booleanBuckets(
      "required",
      "Required",
      "Optional",
      (item) => item.required,
    );
  }
  if (group === "blocked") {
    return booleanBuckets(
      "blocked",
      "Blocked",
      "Unblocked",
      (item) => item.blocked,
    );
  }
  if (group === "applicable") {
    return booleanBuckets(
      "applicable",
      "Applicable",
      "Skipped",
      (item) => item.applicable,
    );
  }

  const labelFor =
    group === "owner"
      ? (item: WorkItemSummary) => workItemAssigneeLabel(item, assignees)
      : group === "source"
        ? workItemSourceLabel
        : workItemStatusLabel;
  const labels = new Map<string, string>();
  for (const item of items) {
    const label = labelFor(item);
    labels.set(label, label);
  }
  const dynamicBuckets = Array.from(labels.keys())
    .sort((left, right) => left.localeCompare(right))
    .map((label) => ({
      id: `${group}:${label}`,
      label,
      rank: 0,
      matches: (item: WorkItemSummary) => labelFor(item) === label,
    }));
  return includeEmpty ? dynamicBuckets : dynamicBuckets;
}

function booleanBuckets(
  id: string,
  trueLabel: string,
  falseLabel: string,
  getter: (item: WorkItemSummary) => boolean,
): Bucket[] {
  return [
    { id: `${id}:true`, label: trueLabel, rank: 0, matches: getter },
    {
      id: `${id}:false`,
      label: falseLabel,
      rank: 1,
      matches: (item) => !getter(item),
    },
  ];
}

function orderBuckets(buckets: Bucket[]) {
  return [...buckets].sort((left, right) => {
    const rankDelta = left.rank - right.rank;
    if (rankDelta !== 0) return rankDelta;
    return right.label.localeCompare(left.label);
  });
}

function statusBucketRank(
  category?: WorkItemStatusCategory | string | null,
  displayOrder?: number | null,
) {
  const normalized = String(category ?? "TODO").toUpperCase();
  const categoryRank =
    normalized === "ACTIVE"
      ? 0
      : normalized === "BLOCKED"
        ? 1
        : normalized === "TODO"
          ? 2
          : normalized === "SKIPPED"
            ? 3
            : normalized === "DONE"
              ? 99
              : 50;
  return categoryRank * 1000 + (displayOrder ?? 0);
}

function countGroupRows(group: GroupedListGroup<WorkItemSummary>): number {
  if (group.subgroups?.length) {
    return group.subgroups.reduce(
      (count, subgroup) => count + countGroupRows(subgroup),
      0,
    );
  }
  return group.rows.length;
}

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
