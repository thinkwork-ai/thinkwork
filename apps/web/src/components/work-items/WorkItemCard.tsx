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
import type { WorkItemDisplayProperty } from "./work-item-view-display";

interface WorkItemCardProps {
  item: WorkItemSummary;
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  properties?: WorkItemDisplayProperty[];
  compact?: boolean;
  updating?: boolean;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
}

export function WorkItemCard({
  item,
  spaces,
  statuses,
  properties = ["status", "priority", "owner", "due", "space", "source"],
  compact = false,
  updating,
  onStatusChange,
}: WorkItemCardProps) {
  const primaryThreadId = item.threadLinks?.[0]?.threadId;
  const dueSoon = isWorkItemDueSoon(item.dueAt);
  const selected = new Set(properties);
  const showMetadata =
    selected.has("due") ||
    selected.has("owner") ||
    selected.has("source") ||
    selected.has("created") ||
    selected.has("updated") ||
    selected.has("completed") ||
    selected.has("required") ||
    selected.has("blocked") ||
    selected.has("applicable");

  return (
    <article className="rounded-md border bg-background p-3 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-5">
            {item.title}
          </h3>
          {selected.has("space") ? (
            <p className="truncate text-xs text-muted-foreground">
              {workItemSpaceLabel(item.spaceId, spaces)}
            </p>
          ) : null}
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
        {selected.has("status") ? <WorkItemStatusBadge item={item} /> : null}
        {selected.has("priority") ? (
          <Badge
            variant="secondary"
            className={cn(
              "rounded-full text-xs",
              workItemPriorityTone(item.priority),
            )}
          >
            {workItemPriorityLabel(item.priority)}
          </Badge>
        ) : null}
      </div>

      {showMetadata ? (
        <dl className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-muted-foreground">
          {selected.has("due") ? (
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
          ) : null}
          {selected.has("owner") ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <UserRound className="size-3.5 shrink-0" />
              <span className="truncate">{workItemOwnerLabel(item)}</span>
            </div>
          ) : null}
          {selected.has("source") ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <MessageSquareText className="size-3.5 shrink-0" />
              <span className="truncate">
                {workItemThreadCountLabel(item)} - {workItemSourceLabel(item)}
              </span>
            </div>
          ) : null}
          {selected.has("created") ? (
            <MetadataText label="Created" value={item.createdAt} />
          ) : null}
          {selected.has("updated") ? (
            <MetadataText label="Updated" value={item.updatedAt} />
          ) : null}
          {selected.has("completed") ? (
            <MetadataText label="Completed" value={item.completedAt} />
          ) : null}
          {selected.has("required") ? (
            <PlainMetadata value={item.required ? "Required" : "Optional"} />
          ) : null}
          {selected.has("blocked") ? (
            <PlainMetadata value={item.blocked ? "Blocked" : "Unblocked"} />
          ) : null}
          {selected.has("applicable") ? (
            <PlainMetadata value={item.applicable ? "Applicable" : "Skipped"} />
          ) : null}
        </dl>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
        <WorkItemStatusSelect
          item={item}
          statuses={statuses}
          disabled={updating}
          onChange={(status) => onStatusChange(item, status)}
        />
        {primaryThreadId ? (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
          >
            <Link to="/threads/$id" params={{ id: primaryThreadId }}>
              Open
            </Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function MetadataText({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">
        {label} {value ? new Date(value).toLocaleDateString() : "-"}
      </span>
    </div>
  );
}

function PlainMetadata({ value }: { value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{value}</span>
    </div>
  );
}
