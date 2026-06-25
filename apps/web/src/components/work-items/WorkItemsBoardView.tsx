import { type GroupedListGroup } from "@thinkwork/ui";
import {
  type WorkItemAssigneeSummary,
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  sortWorkItemStatuses,
} from "./work-item-display";
import { WorkItemCard } from "./WorkItemCard";
import {
  groupWorkItemsForDisplay,
  type WorkItemDisplayState,
} from "./work-item-view-display";

interface WorkItemsBoardViewProps {
  items: WorkItemSummary[];
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  assignees?: WorkItemAssigneeSummary[];
  display: WorkItemDisplayState["board"];
  updatingItemId?: string | null;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
}

export function WorkItemsBoardView({
  items,
  spaces,
  statuses,
  assignees = [],
  display,
  updatingItemId,
  onStatusChange,
}: WorkItemsBoardViewProps) {
  const sortedStatuses = sortWorkItemStatuses(statuses);
  const columns = groupWorkItemsForDisplay({
    items,
    spaces,
    statuses: sortedStatuses,
    group: display.column,
    subgroup: "none",
    sort: display.sort,
    dir: display.dir,
    showEmptyGroups: display.showEmptyColumns,
    showEmptySubgroups: false,
    assignees,
  });

  if (columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border text-sm text-muted-foreground">
        No Work Items are available for this board.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-x-auto">
      <div className="grid h-full min-w-max auto-cols-[minmax(18rem,1fr)] grid-flow-col gap-3 pb-2">
        {columns.map((column) => (
          <section
            key={column.id}
            className="flex min-h-0 w-[18rem] flex-col rounded-md border bg-muted/25"
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
              <h2 className="truncate text-sm font-semibold">{column.label}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {countGroupRows(column)}
              </span>
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {countGroupRows(column) === 0 ? (
                <div className="rounded-md border border-dashed bg-background/70 p-3 text-xs text-muted-foreground">
                  No Work Items
                </div>
              ) : display.row === "none" ? (
                column.rows.map((item) => (
                  <WorkItemCard
                    key={item.id}
                    item={item}
                    spaces={spaces}
                    statuses={sortedStatuses}
                    properties={display.properties}
                    assignees={assignees}
                    compact
                    updating={updatingItemId === item.id}
                    onStatusChange={onStatusChange}
                  />
                ))
              ) : (
                rowGroupsForColumn({
                  column,
                  display,
                  spaces,
                  statuses: sortedStatuses,
                  assignees,
                }).map((rowGroup) => (
                  <div key={rowGroup.id} className="grid gap-2">
                    <div className="flex items-center justify-between gap-2 px-1 text-xs font-medium text-muted-foreground">
                      <span className="truncate">{rowGroup.label}</span>
                      <span className="tabular-nums">
                        {countGroupRows(rowGroup)}
                      </span>
                    </div>
                    {rowGroup.subgroups?.length
                      ? rowGroup.subgroups.map((subgroup) => (
                          <div key={subgroup.id} className="grid gap-2">
                            <div className="px-1 text-[11px] font-medium text-muted-foreground">
                              {subgroup.label}
                            </div>
                            {subgroup.rows.map((item) => (
                              <WorkItemCard
                                key={item.id}
                                item={item}
                                spaces={spaces}
                                statuses={sortedStatuses}
                                properties={display.properties}
                                assignees={assignees}
                                compact
                                updating={updatingItemId === item.id}
                                onStatusChange={onStatusChange}
                              />
                            ))}
                          </div>
                        ))
                      : rowGroup.rows.map((item) => (
                          <WorkItemCard
                            key={item.id}
                            item={item}
                            spaces={spaces}
                            statuses={sortedStatuses}
                            properties={display.properties}
                            assignees={assignees}
                            compact
                            updating={updatingItemId === item.id}
                            onStatusChange={onStatusChange}
                          />
                        ))}
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function rowGroupsForColumn({
  column,
  display,
  spaces,
  statuses,
  assignees,
}: {
  column: GroupedListGroup<WorkItemSummary>;
  display: WorkItemDisplayState["board"];
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  assignees: WorkItemAssigneeSummary[];
}) {
  return groupWorkItemsForDisplay({
    items: column.rows,
    spaces,
    statuses,
    group: display.row,
    subgroup: display.subgroup,
    sort: display.sort,
    dir: display.dir,
    showEmptyGroups: display.showEmptyRows,
    showEmptySubgroups: display.showEmptyRows,
    assignees,
  });
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
