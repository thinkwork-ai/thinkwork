import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  CircleDashed,
  MessageSquareText,
  Minus,
} from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
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
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
  workItemThreadCountLabel,
} from "./work-item-display";
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
  includeSpace,
  updatingItemId,
  onStatusChange,
}: WorkItemsListViewProps) {
  const lanes = sortWorkItemStatuses(statuses);
  const visibleLanes = lanes
    .map((status) => ({
      status,
      items: items.filter((item) => workItemMatchesStatus(item, status)),
    }))
    .filter((lane) => lane.items.length > 0);

  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-72 items-center justify-center rounded-md border border-dashed bg-muted/15 px-6 text-center">
        <div className="max-w-sm">
          <CircleDashed className="mx-auto mb-3 size-8 text-muted-foreground" />
          <h2 className="text-sm font-semibold">No work items in this view</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Change the filters or pick another saved view to inspect active
            work.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto rounded-md border bg-background">
      <div className="min-w-[54rem]">
        {visibleLanes.map(({ status, items: laneItems }) => (
          <section key={status.id} className="border-b last:border-b-0">
            <header className="sticky top-0 z-10 flex h-11 items-center gap-3 border-b bg-muted/55 px-3 backdrop-blur">
              <StatusDot category={status.category} />
              <h2 className="text-sm font-semibold">
                {status.name || workItemStatusCategoryLabel(status.category)}
              </h2>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {laneItems.length}
              </span>
            </header>
            <div className="divide-y">
              {laneItems.map((item) => (
                <WorkItemRow
                  key={item.id}
                  item={item}
                  spaces={spaces}
                  statuses={lanes}
                  includeSpace={includeSpace}
                  updating={updatingItemId === item.id}
                  onStatusChange={onStatusChange}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function WorkItemRow({
  item,
  spaces,
  statuses,
  includeSpace,
  updating,
  onStatusChange,
}: {
  item: WorkItemSummary;
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  includeSpace: boolean;
  updating: boolean;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
}) {
  const primaryThreadId = item.threadLinks?.[0]?.threadId;

  return (
    <article className="grid min-h-16 grid-cols-[minmax(18rem,1fr)_10rem_8rem_8rem_8rem] items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/35">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot category={workItemStatusCategory(item)} />
          <h3 className="truncate text-sm font-semibold">{item.title}</h3>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {includeSpace ? (
            <span className="truncate">
              {workItemSpaceLabel(item.spaceId, spaces)}
            </span>
          ) : null}
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

      <WorkItemStatusSelect
        item={item}
        statuses={statuses}
        disabled={updating}
        onChange={(status) => onStatusChange(item, status)}
      />

      <Badge
        variant="secondary"
        className={`w-fit rounded-full text-xs ${workItemPriorityTone(
          item.priority,
        )}`}
      >
        {workItemPriorityLabel(item.priority)}
      </Badge>

      <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <CalendarDays className="size-3.5 shrink-0" />
        <span className="truncate">{workItemDueLabel(item.dueAt)}</span>
      </span>

      {primaryThreadId ? (
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
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Minus className="size-3.5" />
          {workItemThreadCountLabel(item)}
        </span>
      )}
    </article>
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

function workItemMatchesStatus(
  item: WorkItemSummary,
  status: WorkItemStatusSummary,
) {
  if (status.spaceId && item.status?.id) {
    return item.status.id === status.id;
  }
  return workItemStatusCategory(item) === status.category;
}
