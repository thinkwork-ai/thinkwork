import type React from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  MessageSquareText,
  Minus,
  UserRound,
} from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { relativeTime } from "@/lib/utils";
import {
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemDueLabel,
  workItemOwnerLabel,
  workItemPriorityLabel,
  workItemPriorityTone,
  workItemSourceLabel,
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemThreadCountLabel,
} from "./work-item-display";
import { WorkItemStatusBadge } from "./WorkItemStatusBadge";
import { WorkItemStatusSelect } from "./WorkItemStatusSelect";
import type { WorkItemDisplayProperty } from "./work-item-view-display";

interface WorkItemListRowProps {
  item: WorkItemSummary;
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  properties: WorkItemDisplayProperty[];
  includeSpace: boolean;
  updating: boolean;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
}

export function WorkItemListRow({
  item,
  spaces,
  statuses,
  properties,
  includeSpace,
  updating,
  onStatusChange,
}: WorkItemListRowProps) {
  const primaryThreadId = item.threadLinks?.[0]?.threadId;
  const selected = new Set(properties);

  return (
    <article className="grid min-h-16 grid-cols-[minmax(18rem,1fr)_10rem_8rem] items-center gap-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot category={workItemStatusCategory(item)} />
          <h3 className="truncate text-sm font-semibold">{item.title}</h3>
          {selected.has("status") ? <WorkItemStatusBadge item={item} /> : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {selected.has("space") && includeSpace ? (
            <PropertyText>
              {workItemSpaceLabel(item.spaceId, spaces)}
            </PropertyText>
          ) : null}
          {selected.has("owner") ? (
            <PropertyText icon={<UserRound className="size-3.5" />}>
              {workItemOwnerLabel(item)}
            </PropertyText>
          ) : null}
          {selected.has("due") ? (
            <PropertyText icon={<CalendarDays className="size-3.5" />}>
              {workItemDueLabel(item.dueAt)}
            </PropertyText>
          ) : null}
          {selected.has("source") ? (
            <PropertyText icon={<MessageSquareText className="size-3.5" />}>
              {workItemThreadCountLabel(item)} - {workItemSourceLabel(item)}
            </PropertyText>
          ) : null}
          {selected.has("created") ? (
            <PropertyText icon={<Clock3 className="size-3.5" />}>
              Created {item.createdAt ? relativeTime(item.createdAt) : "-"}
            </PropertyText>
          ) : null}
          {selected.has("updated") ? (
            <PropertyText icon={<Clock3 className="size-3.5" />}>
              Updated {item.updatedAt ? relativeTime(item.updatedAt) : "-"}
            </PropertyText>
          ) : null}
          {selected.has("completed") ? (
            <PropertyText icon={<CheckCircle2 className="size-3.5" />}>
              Completed{" "}
              {item.completedAt ? relativeTime(item.completedAt) : "-"}
            </PropertyText>
          ) : null}
          {selected.has("required") ? (
            <PropertyText
              icon={
                item.required ? (
                  <CircleAlert className="size-3.5" />
                ) : (
                  <CircleDashed className="size-3.5" />
                )
              }
            >
              {item.required ? "Required" : "Optional"}
            </PropertyText>
          ) : null}
          {selected.has("blocked") ? (
            <PropertyText
              icon={
                item.blocked ? (
                  <CircleAlert className="size-3.5" />
                ) : (
                  <CircleDashed className="size-3.5" />
                )
              }
            >
              {item.blocked ? "Blocked" : "Unblocked"}
            </PropertyText>
          ) : null}
          {selected.has("applicable") ? (
            <PropertyText>
              {item.applicable ? "Applicable" : "Skipped"}
            </PropertyText>
          ) : null}
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

      <div className="flex min-w-0 items-center justify-end gap-2">
        {selected.has("priority") ? (
          <Badge
            variant="secondary"
            className={`w-fit rounded-full text-xs ${workItemPriorityTone(
              item.priority,
            )}`}
          >
            {workItemPriorityLabel(item.priority)}
          </Badge>
        ) : null}
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
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Minus className="size-3.5" />
            No thread
          </span>
        )}
      </div>
    </article>
  );
}

function PropertyText({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 truncate">
      {icon}
      <span className="truncate">{children}</span>
    </span>
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
