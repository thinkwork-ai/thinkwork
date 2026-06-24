import { type WorkItemSpaceSummary, type WorkItemStatusSummary, type WorkItemSummary, sortWorkItemStatuses, workItemStatusCategory, workItemStatusCategoryLabel } from "./work-item-display";
import { WorkItemCard } from "./WorkItemCard";
import { WorkItemStatusBadge } from "./WorkItemStatusBadge";

interface WorkItemsBoardViewProps {
  items: WorkItemSummary[];
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  updatingItemId?: string | null;
  onStatusChange: (item: WorkItemSummary, status: WorkItemStatusSummary) => void;
}

export function WorkItemsBoardView({
  items,
  spaces,
  statuses,
  updatingItemId,
  onStatusChange,
}: WorkItemsBoardViewProps) {
  const lanes = sortWorkItemStatuses(statuses);

  if (lanes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border text-sm text-muted-foreground">
        No statuses are available for this view.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-x-auto">
      <div className="grid h-full min-w-max auto-cols-[minmax(18rem,1fr)] grid-flow-col gap-3 pb-2">
        {lanes.map((status) => {
          const laneItems = items.filter((item) =>
            workItemMatchesStatus(item, status),
          );
          return (
            <section
              key={status.id}
              className="flex min-h-0 w-[18rem] flex-col rounded-md border bg-muted/25"
            >
              <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                <WorkItemStatusBadge
                  category={status.category}
                  label={status.name || workItemStatusCategoryLabel(status.category)}
                />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {laneItems.length}
                </span>
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {laneItems.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-background/70 p-3 text-xs text-muted-foreground">
                    No Work Items
                  </div>
                ) : (
                  laneItems.map((item) => (
                    <WorkItemCard
                      key={item.id}
                      item={item}
                      spaces={spaces}
                      statuses={lanes}
                      compact
                      updating={updatingItemId === item.id}
                      onStatusChange={onStatusChange}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function workItemMatchesStatus(
  item: WorkItemSummary,
  status: WorkItemStatusSummary,
) {
  if (status.spaceId && item.status?.id) {
    return item.status.id === status.id;
  }
  return workItemStatusCategory(item) === status.category;
}
