import { type ReactNode, useEffect, useState } from "react";
import { Check, Filter, X, ArrowUpDown, Layers, Search } from "lucide-react";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Checkbox } from "./checkbox.js";
import { Popover, PopoverTrigger, PopoverContent } from "./popover.js";
import { cn } from "../../lib/utils.js";

// ---------------------------------------------------------------------------
// FilterBarSearch — debounced search input
// ---------------------------------------------------------------------------

interface FilterBarSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
}

export function FilterBarSearch({
  value,
  onChange,
  placeholder = "Search...",
  className,
  debounceMs = 300,
}: FilterBarSearchProps) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    const t = window.setTimeout(() => onChange(local), debounceMs);
    return () => window.clearTimeout(t);
  }, [local, debounceMs, onChange]);

  // Sync external value changes
  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="pl-7 text-xs sm:text-sm"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterBarFacet — popover with checkbox list
// ---------------------------------------------------------------------------

interface FacetOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface FilterBarFacetProps {
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export function FilterBarFacet({
  label,
  options,
  selected,
  onChange,
}: FilterBarFacetProps) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="space-y-0.5">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer"
          >
            <Checkbox
              checked={selected.includes(opt.value)}
              onCheckedChange={() => onChange(toggleInArray(selected, opt.value))}
            />
            {opt.icon}
            <span className="text-sm">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterBarSort — sort field/direction popover
// ---------------------------------------------------------------------------

interface SortOption {
  value: string;
  label: string;
}

interface FilterBarSortProps {
  options: SortOption[];
  field: string;
  direction: "asc" | "desc";
  onChange: (field: string, direction: "asc" | "desc") => void;
}

export function FilterBarSort({
  options,
  field,
  direction,
  onChange,
}: FilterBarSortProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs">
          <ArrowUpDown className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
          <span className="hidden sm:inline">Sort</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-0">
        <div className="p-2 space-y-0.5">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={cn(
                "flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm",
                field === opt.value
                  ? "bg-accent/50 text-foreground"
                  : "hover:bg-accent/50 text-muted-foreground",
              )}
              onClick={() => {
                if (field === opt.value) {
                  onChange(field, direction === "asc" ? "desc" : "asc");
                } else {
                  onChange(opt.value, "asc");
                }
              }}
            >
              <span>{opt.label}</span>
              {field === opt.value && (
                <span className="text-xs text-muted-foreground">
                  {direction === "asc" ? "\u2191" : "\u2193"}
                </span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// FilterBarGroup — group-by popover
// ---------------------------------------------------------------------------

interface GroupOption {
  value: string;
  label: string;
}

interface FilterBarGroupProps {
  options: GroupOption[];
  value: string;
  onChange: (value: string) => void;
}

export function FilterBarGroup({
  options,
  value,
  onChange,
}: FilterBarGroupProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs">
          <Layers className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
          <span className="hidden sm:inline">Group</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-0">
        <div className="p-2 space-y-0.5">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={cn(
                "flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm",
                value === opt.value
                  ? "bg-accent/50 text-foreground"
                  : "hover:bg-accent/50 text-muted-foreground",
              )}
              onClick={() => onChange(opt.value)}
            >
              <span>{opt.label}</span>
              {value === opt.value && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// FilterBarPopover — full filter popover with clear and active count
// ---------------------------------------------------------------------------

interface FilterBarPopoverProps {
  activeCount: number;
  onClearAll: () => void;
  children: ReactNode;
}

export function FilterBarPopover({
  activeCount,
  onClearAll,
  children,
}: FilterBarPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "text-xs",
            activeCount > 0 && "text-blue-600 dark:text-blue-400",
          )}
        >
          <Filter className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
          <span className="hidden sm:inline">
            {activeCount > 0 ? `Filters: ${activeCount}` : "Filter"}
          </span>
          {activeCount > 0 && (
            <X
              className="h-3 w-3 ml-1 hidden sm:block"
              onClick={(e) => {
                e.stopPropagation();
                onClearAll();
              }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(480px,calc(100vw-2rem))] p-0"
      >
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Filters</span>
            {activeCount > 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={onClearAll}
              >
                Clear
              </button>
            )}
          </div>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
