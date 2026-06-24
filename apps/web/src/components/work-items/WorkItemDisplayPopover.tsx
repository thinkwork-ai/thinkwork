import type React from "react";
import { useState } from "react";
import {
  KanbanSquare,
  List,
  Rows3,
  SlidersHorizontal,
  TableColumnsSplit,
} from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from "@thinkwork/ui";
import { type WorkItemRouteSearch } from "./work-item-filters";

interface WorkItemDisplayPopoverProps {
  state: WorkItemRouteSearch;
  onChange: (state: WorkItemRouteSearch) => void;
}

export function WorkItemDisplayPopover({
  state,
  onChange,
}: WorkItemDisplayPopoverProps) {
  const [showEmptyColumns, setShowEmptyColumns] = useState(false);
  const [showEmptyRows, setShowEmptyRows] = useState(false);
  const [allowDragDrop, setAllowDragDrop] = useState(true);

  const update = (patch: Partial<WorkItemRouteSearch>) =>
    onChange({ ...state, ...patch, savedViewId: undefined });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Display"
          title="Display"
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[25rem] p-4">
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={state.view !== "board"}
            icon={<List className="size-5" />}
            label="List"
            onClick={() => update({ view: "list" })}
          />
          <ModeButton
            active={state.view === "board"}
            icon={<KanbanSquare className="size-5" />}
            label="Board"
            onClick={() => update({ view: "board" })}
          />
        </div>

        <div className="mt-5 grid gap-3">
          <SelectRow
            icon={<TableColumnsSplit className="size-4" />}
            label="Columns"
            value="status"
            disabled
          >
            <SelectItem value="status">Status</SelectItem>
          </SelectRow>
          <SelectRow
            icon={<Rows3 className="size-4" />}
            label="Rows"
            value="space"
            disabled
          >
            <SelectItem value="space">Space</SelectItem>
          </SelectRow>
          <SelectRow
            label="Sort By"
            value={state.sort ?? "updated"}
            onValueChange={(value) =>
              update({ sort: value as WorkItemRouteSearch["sort"] })
            }
          >
            <SelectItem value="updated">Updated</SelectItem>
            <SelectItem value="due">Due date</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="title">Title</SelectItem>
          </SelectRow>
          <SelectRow label="Direction" value="desc" disabled>
            <SelectItem value="desc">Descending</SelectItem>
          </SelectRow>
        </div>

        <Separator className="my-4" />

        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">Board options</h3>
          <SwitchRow
            label="Show empty columns"
            checked={showEmptyColumns}
            onCheckedChange={setShowEmptyColumns}
          />
          <SwitchRow
            label="Show empty rows"
            checked={showEmptyRows}
            onCheckedChange={setShowEmptyRows}
          />
          <SwitchRow
            label="Allow drag & drop"
            checked={allowDragDrop}
            onCheckedChange={setAllowDragDrop}
          />
        </div>

        <Separator className="my-4" />

        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">Display properties</h3>
          <div className="flex flex-wrap gap-2">
            {[
              "Status",
              "Priority",
              "Assignee",
              "Due date",
              "Estimate",
              "Progress",
              "Organization",
              "Created",
              "Completed",
            ].map((property) => (
              <span
                key={property}
                className="rounded-md border border-border px-2.5 py-1 text-sm"
              >
                {property}
              </span>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={`h-14 flex-col gap-1 ${active ? "border-foreground/60 bg-muted/60" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

function SelectRow({
  icon,
  label,
  value,
  disabled,
  onValueChange,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_11rem] items-center gap-3">
      <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      <Select value={value} disabled={disabled} onValueChange={onValueChange}>
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
