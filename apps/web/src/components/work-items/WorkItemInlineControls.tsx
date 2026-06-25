import type React from "react";
import { useState } from "react";
import { Check, UserRound } from "lucide-react";
import { IconCircleCheckFilled } from "@tabler/icons-react";
import {
  Button,
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
  type WorkItemAssigneeSummary,
  type WorkItemStatusCategory,
  type WorkItemStatusSummary,
  normalizeWorkItemStatusCategory,
  workItemAssigneeColorClass,
  workItemStatusCategoryLabel,
} from "./work-item-display";

function stopPropagation(event: React.MouseEvent) {
  event.stopPropagation();
}

export function WorkItemStatusIconSelector({
  title,
  currentStatusId,
  currentCategory,
  currentColor,
  statuses,
  disabled,
  triggerClassName,
  onChange,
}: {
  title: string;
  currentStatusId?: string | null;
  currentCategory?: WorkItemStatusCategory | string | null;
  currentColor?: string | null;
  statuses: WorkItemStatusSummary[];
  disabled?: boolean;
  triggerClassName?: string;
  onChange: (status: WorkItemStatusSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentValue =
    currentStatusId && statuses.some((status) => status.id === currentStatusId)
      ? currentStatusId
      : normalizeWorkItemStatusCategory(currentCategory);
  const currentStatus = statuses.find((status) => status.id === currentValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 shrink-0 rounded-full p-0 hover:bg-muted",
            triggerClassName,
          )}
          aria-label={`Change status for ${title}`}
          disabled={disabled || statuses.length === 0}
          onClick={stopPropagation}
        >
          <StatusGlyph
            category={currentStatus?.category ?? currentCategory}
            color={currentStatus?.color ?? currentColor}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={2}
        className="w-[226px] gap-0 rounded-lg p-0"
        onClick={stopPropagation}
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

export function WorkItemAssigneeSelector({
  label,
  selectedId,
  assignees,
  disabled,
  variant = "avatar",
  triggerClassName,
  onChange,
}: {
  label: string;
  selectedId?: string | null;
  assignees: WorkItemAssigneeSummary[];
  disabled?: boolean;
  variant?: "avatar" | "text";
  triggerClassName?: string;
  onChange: (ownerUserId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
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
          size={variant === "text" ? "sm" : "icon"}
          title={`Assignee: ${label}`}
          aria-label={`Assignee: ${label}`}
          disabled={disabled}
          className={
            variant === "text"
              ? cn(
                  "h-auto min-w-0 justify-start rounded-sm px-0 py-0 text-xs font-medium leading-none text-muted-foreground hover:bg-transparent hover:text-foreground",
                  triggerClassName,
                )
              : cn(
                  "size-6 shrink-0 rounded-full p-0 text-[11px] font-semibold hover:opacity-90",
                  workItemAssigneeColorClass(assigneeSeed),
                  triggerClassName,
                )
          }
          onClick={stopPropagation}
        >
          {variant === "text" ? (
            <span className="truncate">{label}</span>
          ) : selectedId ? (
            initials(label)
          ) : (
            <UserRound className="size-3" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={variant === "text" ? "start" : "end"}
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
                    selectedId === null || selectedId === undefined
                      ? "opacity-100"
                      : "opacity-0",
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

export function StatusGlyph({
  category,
  color,
}: {
  category: WorkItemStatusCategory | string | null | undefined;
  color?: string | null;
}) {
  const normalizedCategory = normalizeWorkItemStatusCategory(category);

  if (normalizedCategory === "DONE") {
    return (
      <IconCircleCheckFilled className="size-[22px] shrink-0 text-green-600" />
    );
  }

  if (normalizedCategory === "TODO") {
    return (
      <span
        className="size-[18px] shrink-0 rounded-full border-2"
        style={{ borderColor: color || statusColor(category) }}
      />
    );
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

function statusColor(category?: WorkItemStatusCategory | string | null) {
  switch (normalizeWorkItemStatusCategory(category)) {
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

function initials(label: string) {
  if (!label || label === "Unassigned") return "-";
  const parts = label.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
