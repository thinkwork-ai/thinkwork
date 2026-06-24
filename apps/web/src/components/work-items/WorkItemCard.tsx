import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  CalendarClock,
  MessageSquareText,
  UserRound,
} from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import {
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  isWorkItemDueSoon,
  workItemDueLabel,
  workItemOwnerLabel,
  workItemPriorityLabel,
  workItemPriorityTone,
  workItemSourceLabel,
  workItemSpaceLabel,
  workItemThreadCountLabel,
} from "./work-item-display";
import { WorkItemStatusBadge } from "./WorkItemStatusBadge";
import { WorkItemStatusSelect } from "./WorkItemStatusSelect";

interface WorkItemCardProps {
  item: WorkItemSummary;
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  compact?: boolean;
  updating?: boolean;
  onStatusChange: (item: WorkItemSummary, status: WorkItemStatusSummary) => void;
}

export function WorkItemCard({
  item,
  spaces,
  statuses,
  compact = false,
  updating,
  onStatusChange,
}: WorkItemCardProps) {
  const primaryThreadId = item.threadLinks?.[0]?.threadId;
  const dueSoon = isWorkItemDueSoon(item.dueAt);

  return (
    <article className="rounded-md border bg-background p-3 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-5">
            {item.title}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {workItemSpaceLabel(item.spaceId, spaces)}
          </p>
        </div>
        {item.blocked ? (
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : null}
      </div>

      {item.notes && !compact ? (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {item.notes}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <WorkItemStatusBadge item={item} />
        <Badge
          variant="secondary"
          className={cn("rounded-full text-xs", workItemPriorityTone(item.priority))}
        >
          {workItemPriorityLabel(item.priority)}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <CalendarClock
            className={cn(
              "size-3.5 shrink-0",
              dueSoon && "text-amber-600 dark:text-amber-300",
            )}
          />
          <span className={cn("truncate", dueSoon && "text-foreground")}>
            {workItemDueLabel(item.dueAt)}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <UserRound className="size-3.5 shrink-0" />
          <span className="truncate">{workItemOwnerLabel(item)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <MessageSquareText className="size-3.5 shrink-0" />
          <span className="truncate">
            {workItemThreadCountLabel(item)} - {workItemSourceLabel(item)}
          </span>
        </div>
      </dl>

      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
        <WorkItemStatusSelect
          item={item}
          statuses={statuses}
          disabled={updating}
          onChange={(status) => onStatusChange(item, status)}
        />
        {primaryThreadId ? (
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Link to="/threads/$id" params={{ id: primaryThreadId }}>
              Open
            </Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
