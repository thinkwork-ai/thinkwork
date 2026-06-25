import type React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  KanbanSquare,
  Layers2,
  List,
  Rows3,
  SlidersHorizontal,
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
import { cn } from "@/lib/utils";
import type { WorkItemRouteSearch } from "./work-item-filters";
import {
  WORK_ITEM_BOARD_COLUMN_OPTIONS,
  WORK_ITEM_GROUP_OPTIONS,
  WORK_ITEM_PROPERTY_OPTIONS,
  WORK_ITEM_SORT_OPTIONS,
  type WorkItemDisplayGroup,
  type WorkItemDisplayProperty,
  type WorkItemDisplayState,
} from "./work-item-view-display";

interface WorkItemDisplayHeaderProps {
  state: WorkItemRouteSearch;
  onChange: (state: WorkItemRouteSearch) => void;
}

export function WorkItemDisplayHeader({
  state,
  onChange,
}: WorkItemDisplayHeaderProps) {
  const update = (patch: Partial<WorkItemDisplayState>) =>
    onChange({ ...state, ...patch });

  const updateList = (patch: Partial<WorkItemDisplayState["list"]>) =>
    update({ list: { ...state.list, ...patch } });

  const updateBoard = (patch: Partial<WorkItemDisplayState["board"]>) =>
    update({ board: { ...state.board, ...patch } });

  const listSubgroups = availableGroups(state.list.group);
  const boardRows = availableGroups(state.board.column);
  const boardSubgroups = availableGroups(state.board.column, state.board.row);
  const activeProperties =
    state.view === "board" ? state.board.properties : state.list.properties;
  const updateProperties = (properties: WorkItemDisplayProperty[]) => {
    if (state.view === "board") {
      updateBoard({ properties });
      return;
    }
    updateList({ properties });
  };

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
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[320px] max-w-[calc(100vw-1rem)] gap-0 rounded-md p-0"
      >
        <div className="flex w-full gap-2 border-b p-4">
          <ModeButton
            active={state.view === "list"}
            icon={<List className="size-[18px]" aria-hidden="true" />}
            label="List"
            onClick={() => update({ view: "list" })}
          />
          <ModeButton
            active={state.view === "board"}
            icon={<KanbanSquare className="size-[18px]" aria-hidden="true" />}
            label="Board"
            onClick={() => update({ view: "board" })}
          />
        </div>

        <div className="p-4">
          <div className="space-y-2">
            {state.view === "board" ? (
              <>
                <SelectRow
                  icon={<Columns3 className="size-4" aria-hidden="true" />}
                  label="Columns"
                  value={state.board.column}
                  options={WORK_ITEM_BOARD_COLUMN_OPTIONS}
                  onValueChange={(column) =>
                    updateBoard({
                      column,
                      row:
                        state.board.row === column ? "none" : state.board.row,
                      subgroup:
                        state.board.subgroup === column
                          ? "none"
                          : state.board.subgroup,
                    })
                  }
                />
                <SelectRow
                  icon={<Rows3 className="size-4" aria-hidden="true" />}
                  label="Rows"
                  value={state.board.row}
                  options={boardRows}
                  onValueChange={(row) =>
                    updateBoard({
                      row,
                      subgroup:
                        row === "none" || state.board.subgroup === row
                          ? "none"
                          : state.board.subgroup,
                    })
                  }
                />
                <SelectRow
                  icon={<Layers2 className="size-4" aria-hidden="true" />}
                  label="Sub-grouping"
                  value={state.board.subgroup}
                  options={boardSubgroups}
                  onValueChange={(subgroup) => updateBoard({ subgroup })}
                />
                <SortControls
                  sort={state.board.sort}
                  dir={state.board.dir}
                  onSortChange={(sort) => updateBoard({ sort })}
                  onDirectionToggle={() =>
                    updateBoard({
                      dir: state.board.dir === "asc" ? "desc" : "asc",
                    })
                  }
                />
                <Separator className="my-3" />
                <h3 className="text-xs font-medium">Board options</h3>
                <div className="mt-2 space-y-1.5">
                  <SwitchRow
                    label="Show empty columns"
                    checked={state.board.showEmptyColumns}
                    onCheckedChange={(checked) =>
                      updateBoard({ showEmptyColumns: checked })
                    }
                  />
                  <SwitchRow
                    label="Show empty rows"
                    checked={state.board.showEmptyRows}
                    onCheckedChange={(checked) =>
                      updateBoard({ showEmptyRows: checked })
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <SelectRow
                  icon={<Layers2 className="size-4" aria-hidden="true" />}
                  label="Grouping"
                  value={state.list.group}
                  options={WORK_ITEM_GROUP_OPTIONS}
                  onValueChange={(group) =>
                    updateList({
                      group,
                      subgroup:
                        group === "none" || state.list.subgroup === group
                          ? "none"
                          : state.list.subgroup,
                    })
                  }
                />
                <SelectRow
                  icon={<Layers2 className="size-4" aria-hidden="true" />}
                  label="Sub-grouping"
                  value={state.list.subgroup}
                  options={listSubgroups}
                  onValueChange={(subgroup) => updateList({ subgroup })}
                />
                <SortControls
                  sort={state.list.sort}
                  dir={state.list.dir}
                  onSortChange={(sort) => updateList({ sort })}
                  onDirectionToggle={() =>
                    updateList({
                      dir: state.list.dir === "asc" ? "desc" : "asc",
                    })
                  }
                />
                <Separator className="my-3" />
                <h3 className="text-xs font-medium">List options</h3>
                <div className="mt-2 space-y-1.5">
                  <SwitchRow
                    label="Show empty groups"
                    checked={state.list.showEmptyGroups}
                    onCheckedChange={(checked) =>
                      updateList({ showEmptyGroups: checked })
                    }
                  />
                  <SwitchRow
                    label="Show empty sub-groups"
                    checked={state.list.showEmptySubgroups}
                    onCheckedChange={(checked) =>
                      updateList({ showEmptySubgroups: checked })
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <PropertyPicker
          properties={activeProperties}
          onChange={updateProperties}
        />
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
      className={cn(
        "h-auto flex-1 flex-col gap-0.5 rounded-md px-4 py-1 text-xs",
        active && "border-primary/50 bg-muted",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      <span className="text-xs">{label}</span>
    </Button>
  );
}

function SelectRow<Value extends string>({
  icon,
  label,
  value,
  options,
  onValueChange,
}: {
  icon?: React.ReactNode;
  label: string;
  value: Value;
  options: { value: Value; label: string }[];
  onValueChange: (value: Value) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        <span className="min-w-0">{label}</span>
      </span>
      <Select
        value={value}
        onValueChange={(next) => onValueChange(next as Value)}
      >
        <SelectTrigger
          size="sm"
          className="h-7 w-[140px] shrink-0 rounded-md text-[12px]"
          aria-label={label}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
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

function SortControls({
  sort,
  dir,
  onSortChange,
  onDirectionToggle,
}: {
  sort: WorkItemDisplayState["list"]["sort"];
  dir: WorkItemDisplayState["list"]["dir"];
  onSortChange: (sort: WorkItemDisplayState["list"]["sort"]) => void;
  onDirectionToggle: () => void;
}) {
  return (
    <>
      <SelectRow
        icon={<ArrowUpDown className="size-4" aria-hidden="true" />}
        label="Sort By"
        value={sort}
        options={WORK_ITEM_SORT_OPTIONS}
        onValueChange={onSortChange}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <ArrowUpDown className="size-4" aria-hidden="true" />
          Direction
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-[140px] shrink-0 justify-start gap-2 rounded-md text-[12px]"
          onClick={onDirectionToggle}
        >
          {dir === "asc" ? (
            <ArrowUp className="size-4" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-4" aria-hidden="true" />
          )}
          {dir === "asc" ? "Ascending" : "Descending"}
        </Button>
      </div>
    </>
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
    <label className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function PropertyPicker({
  properties,
  onChange,
}: {
  properties: WorkItemDisplayProperty[];
  onChange: (properties: WorkItemDisplayProperty[]) => void;
}) {
  const selected = new Set(properties);

  return (
    <div className="border-t p-4">
      <h3 className="mb-3 text-xs font-medium">Display properties</h3>
      <div className="flex flex-wrap gap-1">
        {WORK_ITEM_PROPERTY_OPTIONS.map((property) => {
          const active = selected.has(property.value);
          const disabled = active && properties.length === 1;
          return (
            <button
              key={property.value}
              type="button"
              className={cn(
                "inline-flex items-center rounded-sm border px-1.5 py-1 text-xs font-normal transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2",
                active
                  ? "border-muted-foreground/60 bg-muted/20 text-foreground"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/10",
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              )}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => {
                if (active) {
                  onChange(
                    properties.filter((value) => value !== property.value),
                  );
                  return;
                }
                onChange([...properties, property.value]);
              }}
            >
              {property.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function availableGroups(
  ...excluded: (WorkItemDisplayGroup | "none")[]
): { value: WorkItemDisplayGroup; label: string }[] {
  return WORK_ITEM_GROUP_OPTIONS.filter(
    (option) => option.value === "none" || !excluded.includes(option.value),
  );
}
