import type React from "react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Asterisk,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  MessageSquareText,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { IconPlanet } from "@tabler/icons-react";
import {
  Badge,
  Button,
  Calendar,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import {
  WORK_ITEM_PRIORITY_ORDER,
  type WorkItemPriority,
  type WorkItemAssigneeSummary,
  type WorkItemSpaceSummary,
  type WorkItemStatusCategory,
  type WorkItemStatusSummary,
  type WorkItemSummary,
  workItemAssigneeColorClass,
  workItemAssigneeLabel,
  workItemPriorityLabel,
  workItemSourceLabel,
  workItemSpaceLabel,
  workItemStatusCategory,
  workItemStatusCategoryLabel,
  workItemThreadCountLabel,
} from "./work-item-display";
import type { WorkItemDisplayProperty } from "./work-item-view-display";

interface WorkItemListRowProps {
  item: WorkItemSummary;
  sequenceNumber?: number;
  spaces: WorkItemSpaceSummary[];
  statuses: WorkItemStatusSummary[];
  assignees?: WorkItemAssigneeSummary[];
  properties: WorkItemDisplayProperty[];
  includeSpace: boolean;
  updating: boolean;
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
    },
  ) => void;
  onItemOpen?: (item: WorkItemSummary) => void;
}

export function WorkItemListRow({
  item,
  sequenceNumber,
  spaces,
  statuses,
  assignees = [],
  properties,
  includeSpace,
  updating,
  onStatusChange,
  onItemUpdate,
  onItemOpen,
}: WorkItemListRowProps) {
  const selected = new Set(properties);
  const primaryThreadId = item.threadLinks?.[0]?.threadId;
  const labels = workItemLabels(item);
  const progress = workItemProgress(item);
  const showDueAndThreadBadges = false;

  return (
    <div
      role="button"
      tabIndex={onItemOpen ? 0 : undefined}
      className={cn(
        "flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-md px-1 outline-none",
        onItemOpen &&
          "cursor-pointer hover:bg-muted/25 focus-visible:ring-1 focus-visible:ring-ring",
        updating && "opacity-60",
      )}
      data-testid="work-item-list-row"
      onClick={() => onItemOpen?.(item)}
      onKeyDown={(event) => {
        if (!onItemOpen) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onItemOpen(item);
        }
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {selected.has("priority") ? (
          <PriorityBadgeSelector
            item={item}
            disabled={updating || !onItemUpdate}
            onChange={(priority) => onItemUpdate?.(item, { priority })}
          />
        ) : null}

        <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground">
          {sequenceNumber ? `WI-${sequenceNumber}` : shortWorkItemKey(item)}
        </span>

        {selected.has("status") ? (
          <StatusIconSelector
            item={item}
            statuses={statuses}
            disabled={updating}
            onChange={(status) => onStatusChange(item, status)}
          />
        ) : null}

        <span className="min-w-0 flex-1 truncate rounded-sm py-0.5 text-sm font-semibold leading-none text-foreground">
          {item.title}
        </span>

        {progress ? <ProgressBadge label={progress} /> : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {labels.length > 0 ? <LabelsBadge labels={labels} /> : null}

        {showDueAndThreadBadges && selected.has("due") ? (
          <DueDateBadgeSelector
            dueAt={item.dueAt}
            disabled={updating || !onItemUpdate}
            onChange={(dueAt) => onItemUpdate?.(item, { dueAt })}
          />
        ) : null}

        {showDueAndThreadBadges && selected.has("source") ? (
          <ThreadBadge item={item} primaryThreadId={primaryThreadId} />
        ) : null}

        {includeSpace && selected.has("space") ? (
          <PillBadge
            icon={<IconPlanet className="size-3.5 text-primary" />}
            label={workItemSpaceLabel(item.spaceId, spaces)}
          />
        ) : null}

        {selected.has("updated") ? (
          <PillBadge
            icon={<Asterisk className="size-3.5" />}
            label={shortDate(item.updatedAt)}
            title={longDateTitle("Updated", item.updatedAt)}
          />
        ) : null}

        {selected.has("completed") && item.completedAt ? (
          <PillBadge
            icon={<CheckCircle2 className="size-3.5" />}
            label={shortDate(item.completedAt)}
            title={longDateTitle("Completed", item.completedAt)}
          />
        ) : null}

        {selected.has("owner") ? (
          <AssigneeSelector
            item={item}
            assignees={assignees}
            disabled={updating || !onItemUpdate}
            onChange={(ownerUserId) => onItemUpdate?.(item, { ownerUserId })}
          />
        ) : null}

        <CreatedDate value={item.createdAt} />
      </div>
    </div>
  );
}

function stopPropagation(event: React.MouseEvent) {
  event.stopPropagation();
}

function StatusIconSelector({
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
  const [open, setOpen] = useState(false);
  const currentValue =
    item.status?.id && statuses.some((status) => status.id === item.status?.id)
      ? item.status.id
      : workItemStatusCategory(item);
  const currentStatus = statuses.find((status) => status.id === currentValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 rounded-full p-0 hover:bg-muted"
          aria-label={`Change status for ${item.title}`}
          disabled={disabled || statuses.length === 0}
          onClick={stopPropagation}
        >
          <StatusGlyph
            category={workItemStatusCategory(item)}
            color={currentStatus?.color}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={2}
        className="w-[226px] gap-0 rounded-lg p-0"
      >
        <Command>
          <CommandInput placeholder="Search status..." className="text-sm" />
          <CommandList>
            <CommandEmpty>No status found.</CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-y-auto p-1">
              {statuses.map((status) => (
                <CommandItem
                  key={status.id}
                  value={status.name}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm"
                  onSelect={() => {
                    onChange(status);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      currentValue === status.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <StatusGlyph
                    category={status.category}
                    color={status.color}
                  />
                  <span className="truncate">
                    {status.name ||
                      workItemStatusCategoryLabel(status.category)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PriorityBadgeSelector({
  item,
  disabled,
  onChange,
}: {
  item: WorkItemSummary;
  disabled?: boolean;
  onChange: (priority: WorkItemPriority) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 rounded-md border border-border bg-muted/10 px-1.5 hover:bg-muted/40"
          aria-label={`Priority: ${workItemPriorityLabel(item.priority)}`}
          disabled={disabled}
          onClick={stopPropagation}
        >
          <PriorityBars priority={item.priority} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={2}
        className="w-[200px] gap-0 rounded-lg p-0"
      >
        <Command>
          <CommandInput placeholder="Search priority..." className="text-sm" />
          <CommandList>
            <CommandEmpty>No priority found.</CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-y-auto p-1">
              {WORK_ITEM_PRIORITY_ORDER.map((priority) => (
                <CommandItem
                  key={priority}
                  value={workItemPriorityLabel(priority)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm"
                  onSelect={() => {
                    onChange(priority);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      item.priority === priority ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <PriorityBars priority={priority} />
                  <span>{workItemPriorityLabel(priority)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DueDateBadgeSelector({
  dueAt,
  disabled,
  onChange,
}: {
  dueAt?: string | null;
  disabled?: boolean;
  onChange: (dueAt: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const value = parseDate(dueAt);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 shrink-0 gap-1 rounded-full border border-border bg-muted/10 px-2 text-xs font-medium text-muted-foreground hover:bg-muted/40",
            isOverdue(dueAt) &&
              "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
          )}
          aria-label={`Due date: ${dueAt ? shortDate(dueAt) : "No due date"}`}
          disabled={disabled}
          onClick={stopPropagation}
        >
          <CalendarDays className="size-3.5" />
          {dueAt ? shortDate(dueAt) : "No date"}
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
        {dueAt ? (
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

function LabelsBadge({ labels }: { labels: WorkItemLabel[] }) {
  const [open, setOpen] = useState(false);
  const visibleDots = labels.slice(0, 3);
  const displayLabel =
    labels.length === 1 ? labels[0].name : `${labels.length} labels`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1.5 rounded-full border border-border bg-muted/10 px-2 text-xs font-medium hover:bg-muted/40"
          aria-label={`Labels: ${labels.map((label) => label.name).join(", ")}`}
          onClick={stopPropagation}
        >
          <span className="flex items-center gap-1">
            {visibleDots.map((label) => (
              <span
                key={label.id}
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color }}
              />
            ))}
          </span>
          <span className="truncate">{displayLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[220px] gap-0 rounded-lg p-0">
        <div className="flex items-center border-b px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className="px-2 text-sm text-muted-foreground">Labels</span>
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {labels.map((label) => (
            <div
              key={label.id}
              className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="truncate">{label.name}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThreadBadge({
  item,
  primaryThreadId,
}: {
  item: WorkItemSummary;
  primaryThreadId?: string;
}) {
  const label = `${workItemThreadCountLabel(item)} - ${workItemSourceLabel(item)}`;

  if (!primaryThreadId) {
    return (
      <PillBadge
        icon={<MessageSquareText className="size-3.5" />}
        label={label}
      />
    );
  }

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="h-6 shrink-0 gap-1 rounded-full border border-border bg-muted/10 px-2 text-xs font-medium text-muted-foreground hover:bg-muted/40"
    >
      <Link
        to="/threads/$id"
        params={{ id: primaryThreadId }}
        onClick={stopPropagation}
      >
        <MessageSquareText className="size-3.5" />
        <span>{label}</span>
      </Link>
    </Button>
  );
}

function PillBadge({
  icon,
  label,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <Badge
      variant="outline"
      title={title}
      className="h-6 shrink-0 gap-1 rounded-full bg-muted/10 px-2 text-xs font-medium text-muted-foreground"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Badge>
  );
}

function AssigneeSelector({
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
  const [open, setOpen] = useState(false);
  const label = workItemAssigneeLabel(item, assignees);
  const selectedId = item.ownerUserId ?? null;
  const assigneeSeed = selectedId
    ? (assignees.find((assignee) => assignee.id === selectedId)?.id ??
      selectedId)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={`Assignee: ${label}`}
          aria-label={`Assignee: ${label}`}
          disabled={disabled}
          className={cn(
            "size-6 shrink-0 rounded-full p-0 text-[11px] font-semibold hover:opacity-90",
            workItemAssigneeColorClass(assigneeSeed),
          )}
          onClick={stopPropagation}
        >
          {selectedId ? initials(label) : <UserRound className="size-3" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[260px] gap-0 rounded-lg p-0"
        onClick={stopPropagation}
      >
        <Command>
          <CommandInput
            placeholder="Search team members..."
            className="text-sm"
          />
          <CommandList>
            <CommandEmpty>No team members found.</CommandEmpty>
            <CommandGroup className="max-h-[320px] overflow-y-auto p-1">
              <CommandItem
                value="Unassigned"
                className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm"
                onClick={stopPropagation}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "size-4 shrink-0",
                    selectedId === null ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UserRound className="size-3.5" />
                </span>
                <span className="truncate">Unassigned</span>
              </CommandItem>
              {assignees.map((assignee) => (
                <CommandItem
                  key={assignee.id}
                  value={`${assignee.name} ${assignee.email ?? ""}`}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm"
                  onClick={stopPropagation}
                  onSelect={() => {
                    onChange(assignee.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      selectedId === assignee.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      workItemAssigneeColorClass(assignee.id),
                    )}
                  >
                    {initials(assignee.name || assignee.email || "User")}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {assignee.name || assignee.email || "User"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ProgressBadge({ label }: { label: string }) {
  return (
    <Badge
      variant="secondary"
      className="h-5 shrink-0 gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground"
    >
      <Circle className="size-3" />
      {label}
    </Badge>
  );
}

function CreatedDate({ value }: { value?: string | null }) {
  return (
    <span
      title={longDateTitle("Created", value)}
      className="shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground"
    >
      {shortMonthDate(value)}
    </span>
  );
}

function StatusGlyph({
  category,
  color,
}: {
  category: WorkItemStatusCategory | string | null | undefined;
  color?: string | null;
}) {
  if (category === "DONE") {
    return <CheckCircle2 className="size-[18px] shrink-0 text-green-600" />;
  }

  const resolvedColor = color || statusColor(category);

  return (
    <span
      className="relative size-[18px] shrink-0 rounded-full border-2"
      style={{ borderColor: resolvedColor }}
    >
      <span
        className="absolute bottom-0 right-0 top-0 w-1/2 rounded-r-full"
        style={{ backgroundColor: resolvedColor }}
      />
    </span>
  );
}

function PriorityBars({
  priority,
}: {
  priority: WorkItemPriority | string | null | undefined;
}) {
  const active = priorityLevel(priority);
  const color = priorityColor(priority);

  return (
    <span className="inline-flex h-3 items-center gap-0.5">
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className="h-3 w-0.5 rounded-full"
          style={{
            backgroundColor:
              index < active ? color : "var(--color-muted-foreground)",
            opacity: index < active ? 1 : 0.35,
          }}
        />
      ))}
    </span>
  );
}

function shortWorkItemKey(item: WorkItemSummary) {
  const metadata = objectRecord(item.metadata);
  const key =
    stringValue(metadata.key) ||
    stringValue(metadata.number) ||
    stringValue(metadata.externalKey) ||
    item.externalRefs?.[0]?.externalId;

  if (key) return key;
  return `WI-${item.id
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 5)
    .toUpperCase()}`;
}

function statusColor(category?: WorkItemStatusCategory | string | null) {
  switch (category) {
    case "DONE":
      return "#16a34a";
    case "BLOCKED":
      return "#dc2626";
    case "ACTIVE":
      return "#f59e0b";
    case "SKIPPED":
      return "#64748b";
    case "TODO":
    default:
      return "#0ea5e9";
  }
}

function priorityLevel(priority?: WorkItemPriority | string | null) {
  switch (String(priority ?? "NORMAL").toUpperCase()) {
    case "URGENT":
      return 4;
    case "HIGH":
      return 3;
    case "LOW":
      return 1;
    case "NORMAL":
    default:
      return 2;
  }
}

function priorityColor(priority?: WorkItemPriority | string | null) {
  switch (String(priority ?? "NORMAL").toUpperCase()) {
    case "URGENT":
      return "#ef4444";
    case "HIGH":
      return "#f97316";
    case "LOW":
      return "#3b82f6";
    case "NORMAL":
    default:
      return "#facc15";
  }
}

function shortDate(value?: string | null) {
  const date = parseDate(value);
  if (!date) return "-";
  return date.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
}

function shortMonthDate(value?: string | null) {
  const date = parseDate(value);
  if (!date) return "-";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function longDateTitle(label: string, value?: string | null) {
  const date = parseDate(value);
  if (!date) return `${label}: -`;
  return `${label}: ${date.toLocaleDateString()}`;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOverdue(value?: string | null) {
  const date = parseDate(value);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

function noonIso(date: Date) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  return next.toISOString();
}

function initials(label: string) {
  if (!label || label === "Unassigned") return "-";
  const parts = label.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

interface WorkItemLabel {
  id: string;
  name: string;
  color: string;
}

function workItemLabels(item: WorkItemSummary): WorkItemLabel[] {
  const metadata = objectRecord(item.metadata);
  const rawLabels = Array.isArray(metadata.labels)
    ? metadata.labels
    : Array.isArray(metadata.tags)
      ? metadata.tags
      : [];

  return rawLabels
    .map((label, index) => {
      if (typeof label === "string") {
        return {
          id: label,
          name: label,
          color: labelColor(index),
        };
      }
      const record = objectRecord(label);
      const name = stringValue(record.name) || stringValue(record.label);
      if (!name) return null;
      return {
        id: stringValue(record.id) || name,
        name,
        color: stringValue(record.color) || labelColor(index),
      };
    })
    .filter((label): label is WorkItemLabel => Boolean(label));
}

function labelColor(index: number) {
  return ["#ef4444", "#06b6d4", "#f97316", "#3b82f6", "#22c55e"][index % 5];
}

function workItemProgress(item: WorkItemSummary) {
  const metadata = objectRecord(item.metadata);
  const completed =
    numberValue(metadata.completed) ?? numberValue(metadata.done);
  const total = numberValue(metadata.total) ?? numberValue(metadata.count);
  if (completed === null || total === null || total <= 0) return null;
  return `${completed}/${total}`;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
