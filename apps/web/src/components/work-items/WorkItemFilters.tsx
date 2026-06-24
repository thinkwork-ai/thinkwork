import { Filter, Search, X } from "lucide-react";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import {
  WORK_ITEM_CATEGORY_ORDER,
  WORK_ITEM_PRIORITY_ORDER,
  type WorkItemSpaceSummary,
  workItemPriorityLabel,
  workItemStatusCategoryLabel,
} from "./work-item-display";
import {
  clearWorkItemFilters,
  hasActiveWorkItemFilters,
  type WorkItemRouteSearch,
} from "./work-item-filters";

const ALL = "__all__";
const TRUE = "true";
const FALSE = "false";

interface WorkItemFiltersProps {
  state: WorkItemRouteSearch;
  spaces: WorkItemSpaceSummary[];
  onChange: (next: WorkItemRouteSearch) => void;
}

export function WorkItemFilters({
  state,
  spaces,
  onChange,
}: WorkItemFiltersProps) {
  const update = (patch: Partial<WorkItemRouteSearch>) =>
    onChange({ ...state, ...patch, savedViewId: undefined });

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label className="relative w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={state.search ?? ""}
          onChange={(event) =>
            update({ search: event.target.value || undefined })
          }
          className="h-9 pl-9"
          placeholder="Search work items"
          aria-label="Search Work Items"
        />
      </label>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2"
          >
            <Filter className="size-4" />
            <span>Filter</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(42rem,calc(100vw-2rem))] p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterSelect label="Space">
              <Select
                value={state.spaceId ?? ALL}
                onValueChange={(value) =>
                  update({ spaceId: value === ALL ? undefined : value })
                }
              >
                <SelectTrigger size="sm" aria-label="Filter by Space">
                  <SelectValue placeholder="All Spaces" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Spaces</SelectItem>
                  {spaces.map((space) => (
                    <SelectItem key={space.id} value={space.id}>
                      {space.name?.trim() || "Space"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterSelect>

            <FilterSelect label="Status">
              <Select
                value={state.statusCategory ?? ALL}
                onValueChange={(value) =>
                  update({
                    statusCategory:
                      value === ALL
                        ? undefined
                        : (value as WorkItemRouteSearch["statusCategory"]),
                  })
                }
              >
                <SelectTrigger size="sm" aria-label="Filter by status">
                  <SelectValue placeholder="Any status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any status</SelectItem>
                  {WORK_ITEM_CATEGORY_ORDER.map((category) => (
                    <SelectItem key={category} value={category}>
                      {workItemStatusCategoryLabel(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterSelect>

            <FilterSelect label="Priority">
              <Select
                value={state.priority ?? ALL}
                onValueChange={(value) =>
                  update({
                    priority:
                      value === ALL
                        ? undefined
                        : (value as WorkItemRouteSearch["priority"]),
                  })
                }
              >
                <SelectTrigger size="sm" aria-label="Filter by priority">
                  <SelectValue placeholder="Any priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any priority</SelectItem>
                  {WORK_ITEM_PRIORITY_ORDER.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {workItemPriorityLabel(priority)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterSelect>

            <FilterSelect label="Due date">
              <Select
                value={state.due ?? ALL}
                onValueChange={(value) =>
                  update({
                    due:
                      value === ALL
                        ? undefined
                        : (value as WorkItemRouteSearch["due"]),
                    sort: value === ALL ? state.sort : "due",
                  })
                }
              >
                <SelectTrigger size="sm" aria-label="Filter by due date">
                  <SelectValue placeholder="Any due" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any due</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="due_soon">Due soon</SelectItem>
                </SelectContent>
              </Select>
            </FilterSelect>

            <FilterSelect label="Required">
              <Select
                value={booleanValue(state.required)}
                onValueChange={(value) =>
                  update({
                    required: value === ALL ? undefined : value === TRUE,
                  })
                }
              >
                <SelectTrigger size="sm" aria-label="Filter required">
                  <SelectValue placeholder="Required" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any required</SelectItem>
                  <SelectItem value={TRUE}>Required</SelectItem>
                  <SelectItem value={FALSE}>Optional</SelectItem>
                </SelectContent>
              </Select>
            </FilterSelect>

            <FilterSelect label="Blocked">
              <Select
                value={booleanValue(state.blocked)}
                onValueChange={(value) =>
                  update({
                    blocked: value === ALL ? undefined : value === TRUE,
                  })
                }
              >
                <SelectTrigger size="sm" aria-label="Filter blocked">
                  <SelectValue placeholder="Blocked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any blocker</SelectItem>
                  <SelectItem value={TRUE}>Blocked</SelectItem>
                  <SelectItem value={FALSE}>Unblocked</SelectItem>
                </SelectContent>
              </Select>
            </FilterSelect>

            <FilterSelect label="Applicability">
              <Select
                value={booleanValue(state.applicable)}
                onValueChange={(value) =>
                  update({
                    applicable: value === ALL ? undefined : value === TRUE,
                  })
                }
              >
                <SelectTrigger size="sm" aria-label="Filter applicable">
                  <SelectValue placeholder="Applicable" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any applicability</SelectItem>
                  <SelectItem value={TRUE}>Applicable</SelectItem>
                  <SelectItem value={FALSE}>Skipped</SelectItem>
                </SelectContent>
              </Select>
            </FilterSelect>

            <FilterSelect label="Sort by">
              <Select
                value={state.sort ?? "updated"}
                onValueChange={(value) =>
                  update({ sort: value as WorkItemRouteSearch["sort"] })
                }
              >
                <SelectTrigger size="sm" aria-label="Sort Work Items">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">Updated</SelectItem>
                  <SelectItem value="due">Due date</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                  <SelectItem value="title">Title</SelectItem>
                </SelectContent>
              </Select>
            </FilterSelect>
          </div>
        </PopoverContent>
      </Popover>

      {hasActiveWorkItemFilters(state) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 px-2"
          onClick={() => onChange(clearWorkItemFilters(state))}
        >
          <X className="size-4" />
          <span>Clear</span>
        </Button>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function booleanValue(value: boolean | undefined) {
  if (value === true) return TRUE;
  if (value === false) return FALSE;
  return ALL;
}
