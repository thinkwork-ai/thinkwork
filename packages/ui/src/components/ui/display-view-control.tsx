"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  List,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import { Separator } from "./separator.js";
import { Switch } from "./switch.js";
import { cn } from "../../lib/utils.js";

export type DisplayViewMode = "table" | "list";
export type DisplaySortDirection = "asc" | "desc";

export interface DisplayControlOption<Value extends string = string> {
  value: Value;
  label: string;
}

export interface DisplayControlState<
  Group extends string = string,
  Sort extends string = string,
  Property extends string = string,
> {
  view: DisplayViewMode;
  group: Group | "none";
  subgroup: Group | "none";
  sort: Sort;
  dir: DisplaySortDirection;
  showEmptyGroups: boolean;
  showEmptySubgroups: boolean;
  properties: Property[];
}

export interface DisplayViewControlProps<
  Group extends string = string,
  Sort extends string = string,
  Property extends string = string,
> {
  state: DisplayControlState<Group, Sort, Property>;
  modes: DisplayControlOption<DisplayViewMode>[];
  groups: DisplayControlOption<Group | "none">[];
  subgroups: DisplayControlOption<Group | "none">[];
  sorts: DisplayControlOption<Sort>[];
  properties: DisplayControlOption<Property>[];
  onStateChange: (state: DisplayControlState<Group, Sort, Property>) => void;
  align?: "start" | "center" | "end";
  triggerVariant?: "button" | "icon";
  triggerLabel?: string;
  className?: string;
}

const modeIcons = {
  table: Table2,
  list: List,
} satisfies Record<
  DisplayViewMode,
  React.ComponentType<{ className?: string }>
>;

export function DisplayViewControl<
  Group extends string,
  Sort extends string,
  Property extends string,
>({
  state,
  modes,
  groups,
  subgroups,
  sorts,
  properties,
  onStateChange,
  align = "end",
  triggerVariant = "button",
  triggerLabel = "Display",
  className,
}: DisplayViewControlProps<Group, Sort, Property>) {
  const [draftState, setDraftState] = React.useState(state);
  const latestState = React.useRef(state);

  React.useEffect(() => {
    latestState.current = state;
    setDraftState(state);
  }, [state]);

  const emit = React.useCallback(
    (patch: Partial<DisplayControlState<Group, Sort, Property>>) => {
      const nextState = { ...latestState.current, ...patch };
      latestState.current = nextState;
      setDraftState(nextState);
      onStateChange(nextState);
    },
    [onStateChange],
  );

  const availableSubgroups = subgroups.filter(
    (option) => option.value === "none" || option.value !== draftState.group,
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        {triggerVariant === "icon" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "size-8 text-muted-foreground/70 hover:bg-white/[0.05] hover:text-foreground/85",
              className,
            )}
            aria-label={triggerLabel}
            title={triggerLabel}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{triggerLabel}</span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("h-8 gap-2", className)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {triggerLabel}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 gap-3">
        <PopoverHeader>
          <PopoverTitle>Display</PopoverTitle>
        </PopoverHeader>

        <div className="grid grid-cols-2 gap-0.5 rounded-md bg-muted/70 p-0.5">
          {modes.map((mode) => {
            const Icon = modeIcons[mode.value];
            const isActive = draftState.view === mode.value;
            return (
              <Button
                key={mode.value}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 justify-center gap-1.5 rounded-[min(var(--radius-md),8px)] px-2 text-xs",
                  isActive
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border hover:bg-background"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
                aria-pressed={isActive}
                onClick={() => emit({ view: mode.value })}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {mode.label}
              </Button>
            );
          })}
        </div>

        {draftState.view === "list" ? (
          <>
            <Separator />
            <div className="grid gap-2">
              <SelectRow
                label="Group"
                value={draftState.group}
                options={groups}
                onValueChange={(group) =>
                  emit({
                    group,
                    subgroup:
                      group === "none" || group === draftState.subgroup
                        ? "none"
                        : draftState.subgroup,
                  })
                }
              />
              <SelectRow
                label="Sub-group"
                value={draftState.subgroup}
                options={availableSubgroups}
                onValueChange={(subgroup) => emit({ subgroup })}
              />
              <SelectRow
                label="Sort"
                value={draftState.sort}
                options={sorts}
                onValueChange={(sort) => emit({ sort })}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  Direction
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-2"
                  onClick={() =>
                    emit({ dir: draftState.dir === "asc" ? "desc" : "asc" })
                  }
                >
                  {draftState.dir === "asc" ? (
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  )}
                  {draftState.dir === "asc" ? "Ascending" : "Descending"}
                </Button>
              </div>
              <SwitchRow
                label="Empty groups"
                checked={draftState.showEmptyGroups}
                onCheckedChange={(checked) =>
                  emit({ showEmptyGroups: checked })
                }
              />
              <SwitchRow
                label="Empty sub-groups"
                checked={draftState.showEmptySubgroups}
                onCheckedChange={(checked) =>
                  emit({ showEmptySubgroups: checked })
                }
              />
            </div>
            <Separator />
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  Properties
                </span>
                <Badge variant="secondary" className="text-[11px]">
                  {draftState.properties.length}
                </Badge>
              </div>
              <div className="grid max-h-44 gap-1 overflow-y-auto pr-1">
                {properties.map((property) => {
                  const checked = draftState.properties.includes(
                    property.value,
                  );
                  const disableUncheck =
                    checked && draftState.properties.length <= 1;
                  return (
                    <label
                      key={property.value}
                      className={cn(
                        "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-accent",
                        disableUncheck && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disableUncheck}
                        onCheckedChange={(next) => {
                          const isChecked = next === true;
                          if (!isChecked && disableUncheck) return;
                          const nextProperties = isChecked
                            ? [...draftState.properties, property.value]
                            : draftState.properties.filter(
                                (value) => value !== property.value,
                              );
                          emit({ properties: nextProperties });
                        }}
                      />
                      <span>{property.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function SelectRow<Value extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: Value;
  options: DisplayControlOption<Value>[];
  onValueChange: (value: Value) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        value={value}
        onValueChange={(next) => onValueChange(next as Value)}
      >
        <SelectTrigger size="sm" className="w-40" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
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
    <label className="flex h-8 items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
