import type React from "react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  CheckCircle2,
  Flag,
  MessageSquareText,
  Tags,
  UserRound,
  X,
} from "lucide-react";
import { IconPlanet } from "@tabler/icons-react";
import {
  Badge,
  Button,
  Calendar,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import {
  WORK_ITEM_PRIORITY_ORDER,
  type WorkItemPriority,
  type WorkItemAssigneeSummary,
  type WorkItemLabelSummary,
  type WorkItemSpaceSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemAssigneeLabel,
  workItemDueLabel,
  workItemLabels,
  workItemPriorityLabel,
  workItemSourceLabel,
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
  workItemStatusLabel,
  workItemThreadCountLabel,
} from "./work-item-display";

interface WorkItemDetailSheetProps {
  item: WorkItemSummary | null;
  sequenceNumber?: number;
  spaces: WorkItemSpaceSummary[];
  labels?: WorkItemLabelSummary[];
  statuses: WorkItemStatusSummary[];
  assignees: WorkItemAssigneeSummary[];
  updating?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (
    item: WorkItemSummary,
    status: WorkItemStatusSummary,
  ) => void;
  onItemUpdate?: (
    item: WorkItemSummary,
    patch: {
      priority?: WorkItemPriority;
      dueAt?: string | null;
      ownerUserId?: string | null;
      labelIds?: string[];
    },
  ) => void;
}

export function WorkItemDetailSheet({
  item,
  sequenceNumber,
  spaces,
  labels = [],
  statuses,
  assignees,
  updating,
  open,
  onOpenChange,
  onStatusChange,
  onItemUpdate,
}: WorkItemDetailSheetProps) {
  const primaryThreadId = item?.threadLinks?.[0]?.threadId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(520px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
        {item ? (
          <>
            <SheetHeader className="border-b border-border/70 px-6 py-5 pr-12">
              <SheetTitle className="text-lg">{item.title}</SheetTitle>
              <SheetDescription>
                {sequenceNumber
                  ? `WI-${sequenceNumber}`
                  : shortWorkItemKey(item)}
              </SheetDescription>
            </SheetHeader>

            <div className="grid gap-5 px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusControl
                  item={item}
                  statuses={statuses}
                  disabled={updating}
                  onChange={(status) => onStatusChange(item, status)}
                />
                <PriorityControl
                  item={item}
                  disabled={updating || !onItemUpdate}
                  onChange={(priority) => onItemUpdate?.(item, { priority })}
                />
                <AssigneeControl
                  item={item}
                  assignees={assignees}
                  disabled={updating || !onItemUpdate}
                  onChange={(ownerUserId) =>
                    onItemUpdate?.(item, { ownerUserId })
                  }
                />
                <DueDateControl
                  item={item}
                  disabled={updating || !onItemUpdate}
                  onChange={(dueAt) => onItemUpdate?.(item, { dueAt })}
                />
                <DetailBadge
                  icon={<IconPlanet className="size-3.5 text-primary" />}
                  label={workItemSpaceLabel(item.spaceId, spaces)}
                />
              </div>

              {labels.length > 0 ? (
                <LabelAssignments
                  item={item}
                  labels={labels}
                  disabled={updating || !onItemUpdate}
                  onChange={(labelIds) => onItemUpdate?.(item, { labelIds })}
                />
              ) : null}

              {item.notes ? (
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">Notes</h3>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.notes}
                  </p>
                </section>
              ) : null}

              <Separator />

              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Source</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <DetailBadge
                    icon={<MessageSquareText className="size-3.5" />}
                    label={`${workItemThreadCountLabel(item)} - ${workItemSourceLabel(item)}`}
                  />
                  {primaryThreadId ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/threads/$id" params={{ id: primaryThreadId }}>
                        Open thread
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function LabelAssignments({
  item,
  labels,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  labels: WorkItemLabelSummary[];
  disabled?: boolean;
  onChange: (labelIds: string[]) => void;
}) {
  const selectedIds = new Set(workItemLabels(item).map((label) => label.id));
  return (
    <section className="grid gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Tags className="size-4 text-muted-foreground" />
        Labels
      </h3>
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => {
          const checked = selectedIds.has(label.id);
          return (
            <label
              key={label.id}
              className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
            >
              <Checkbox
                className="size-3.5"
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => {
                  const next = new Set(selectedIds);
                  if (value === true) next.add(label.id);
                  else next.delete(label.id);
                  onChange([...next]);
                }}
              />
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color ?? "#64748b" }}
              />
              <span>{label.name}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function StatusControl({
  item,
  statuses,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  statuses: WorkItemStatusSummary[];
  disabled?: boolean;
  onChange: (status: WorkItemStatusSummary) => void;
}) {
  const currentValue =
    item.status?.id && statuses.some((status) => status.id === item.status?.id)
      ? item.status.id
      : workItemStatusCategory(item);

  return (
    <Select
      value={currentValue}
      disabled={disabled || statuses.length === 0}
      onValueChange={(value) => {
        const next = statuses.find((status) => status.id === value);
        if (next) onChange(next);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Change status for ${item.title}`}
        className={controlClassName}
      >
        <CheckCircle2 className="size-3.5 shrink-0" />
        <SelectValue placeholder={workItemStatusLabel(item)} />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((status) => (
          <SelectItem key={status.id} value={status.id}>
            {status.name || workItemStatusCategoryLabel(status.category)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PriorityControl({
  item,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  disabled?: boolean;
  onChange: (priority: WorkItemPriority) => void;
}) {
  return (
    <Select
      value={item.priority}
      disabled={disabled}
      onValueChange={(value) => onChange(value as WorkItemPriority)}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Change priority for ${item.title}`}
        className={controlClassName}
      >
        <Flag className="size-3.5 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WORK_ITEM_PRIORITY_ORDER.map((priority) => (
          <SelectItem key={priority} value={priority}>
            {workItemPriorityLabel(priority)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssigneeControl({
  item,
  assignees,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  assignees: WorkItemAssigneeSummary[];
  disabled?: boolean;
  onChange: (ownerUserId: string | null) => void;
}) {
  const value = item.ownerUserId ?? UNASSIGNED_VALUE;

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) =>
        onChange(next === UNASSIGNED_VALUE ? null : next)
      }
    >
      <SelectTrigger
        size="sm"
        aria-label={`Change assignee for ${item.title}`}
        className={controlClassName}
      >
        <UserRound className="size-3.5 shrink-0" />
        <SelectValue placeholder={workItemAssigneeLabel(item, assignees)} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
        {assignees.map((assignee) => (
          <SelectItem key={assignee.id} value={assignee.id}>
            {assignee.name || assignee.email || "User"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DueDateControl({
  item,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  disabled?: boolean;
  onChange: (dueAt: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const value = parseDate(item.dueAt);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Change due date for ${item.title}`}
          className={`${controlClassName} hover:bg-muted/40`}
        >
          <CalendarDays className="size-3.5 shrink-0" />
          <span className="truncate">{workItemDueLabel(item.dueAt)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-0 rounded-lg p-0">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          defaultMonth={value ?? undefined}
          captionLayout="dropdown"
          onSelect={(date) => {
            onChange(date ? noonIso(date) : null);
            setOpen(false);
          }}
        />
        {item.dueAt ? (
          <div className="flex justify-end border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <X className="size-3" />
              Clear
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function DetailBadge({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Badge
      variant="outline"
      className="h-7 max-w-full gap-1.5 rounded-full bg-muted/10 px-2.5 text-xs font-medium text-muted-foreground"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Badge>
  );
}

const UNASSIGNED_VALUE = "__unassigned__";
const controlClassName =
  "h-7 max-w-full gap-1.5 rounded-full border border-border bg-muted/10 px-2.5 text-xs font-medium text-muted-foreground";

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function noonIso(date: Date) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  return next.toISOString();
}

function shortWorkItemKey(item: WorkItemSummary) {
  return `WI-${item.id
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 5)
    .toUpperCase()}`;
}
