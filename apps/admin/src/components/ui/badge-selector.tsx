import { useState, useMemo, type ReactNode } from "react";
import { Calendar as CalendarIcon, Check, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared badge trigger
// ---------------------------------------------------------------------------

interface BadgeTriggerProps {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

function BadgeTrigger({ icon, children, className }: BadgeTriggerProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "cursor-pointer gap-1.5 hover:bg-accent transition-colors",
        className,
      )}
    >
      {icon}
      {children}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// 1. BadgeSelectorText — text input with save
// ---------------------------------------------------------------------------

interface BadgeSelectorTextProps {
  icon?: ReactNode;
  label: string;
  value: string | null;
  placeholder?: string;
  emptyLabel?: string;
  type?: string;
  onSave: (value: string) => void | Promise<void>;
  className?: string;
}

export function BadgeSelectorText({
  icon,
  label,
  value,
  placeholder,
  emptyLabel = "None",
  type = "text",
  onSave,
  className,
}: BadgeSelectorTextProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) setDraft(value ?? "");
    setOpen(isOpen);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button type="button">
          <BadgeTrigger icon={icon} className={className}>
            {value || emptyLabel}
          </BadgeTrigger>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <div className="p-2 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground px-0.5">{label}</p>
          <input
            type={type}
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs px-3"
              onClick={handleSave}
              disabled={saving}
            >
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// 2. BadgeSelectorSelect — single select with optional search
// ---------------------------------------------------------------------------

interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface BadgeSelectorSelectProps {
  icon?: ReactNode;
  label?: string;
  value: string | null;
  emptyLabel?: string;
  options: SelectOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  onSelect: (value: string | null) => void | Promise<void>;
  /** Optional "none" item at top */
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
}

export function BadgeSelectorSelect({
  icon,
  label,
  value,
  emptyLabel = "None",
  options,
  searchable = false,
  searchPlaceholder = "Search...",
  onSelect,
  allowNone = false,
  noneLabel = "None",
  className,
}: BadgeSelectorSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const handleSelect = async (v: string | null) => {
    await onSelect(v);
    setOpen(false);
    setSearch("");
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const displayLabel = value
    ? options.find((o) => o.value === value)?.label ?? value
    : emptyLabel;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button type="button">
          <BadgeTrigger icon={icon} className={className}>
            {displayLabel}
          </BadgeTrigger>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        {searchable && (
          <div className="flex items-center border-b border-border px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              className="flex-1 bg-transparent py-2 px-2 text-sm outline-none placeholder:text-muted-foreground/50"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        )}
        <div className="max-h-52 overflow-y-auto overscroll-contain py-1">
          {allowNone && (
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-sm hover:bg-accent/50 text-muted-foreground",
                value == null && "bg-accent text-accent-foreground",
              )}
              onClick={() => handleSelect(null)}
            >
              <span>{noneLabel}</span>
              {value == null && <Check className="h-3.5 w-3.5" />}
            </button>
          )}
          {filtered.map((opt) => (
            <button
              type="button"
              key={opt.value}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-sm hover:bg-accent/50",
                value === opt.value && "bg-accent text-accent-foreground",
              )}
              onClick={() => handleSelect(opt.value)}
            >
              <span className="flex items-center gap-2 min-w-0 truncate">
                {opt.icon}
                {opt.label}
              </span>
              {value === opt.value && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">No results</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// 3. BadgeSelectorMulti — multi-select (tag picker) with optional search
// ---------------------------------------------------------------------------

interface MultiOption {
  value: string;
  label: string;
  icon?: ReactNode;
  color?: string;
}

interface BadgeSelectorMultiProps {
  icon?: ReactNode;
  label?: string;
  values: string[];
  emptyLabel?: string;
  options: MultiOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  onChange: (values: string[]) => void | Promise<void>;
  className?: string;
}

export function BadgeSelectorMulti({
  icon,
  values,
  emptyLabel = "None",
  options,
  searchable = false,
  searchPlaceholder = "Search...",
  onChange,
  className,
}: BadgeSelectorMultiProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const toggle = (v: string) => {
    const next = values.includes(v)
      ? values.filter((x) => x !== v)
      : [...values, v];
    void onChange(next);
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const displayCount = values.length;
  const displayText = displayCount === 0
    ? emptyLabel
    : displayCount === 1
      ? options.find((o) => o.value === values[0])?.label ?? values[0]
      : `${displayCount} selected`;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button type="button">
          <BadgeTrigger icon={icon} className={className}>
            {displayText}
          </BadgeTrigger>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        {searchable && (
          <div className="flex items-center border-b border-border px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              className="flex-1 bg-transparent py-2 px-2 text-sm outline-none placeholder:text-muted-foreground/50"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        )}
        <div className="max-h-52 overflow-y-auto overscroll-contain py-1">
          {filtered.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-sm hover:bg-accent/50 cursor-pointer",
                  checked && "bg-accent/30",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(opt.value)}
                />
                {opt.color && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                {opt.icon}
                <span className="truncate">{opt.label}</span>
              </label>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">No results</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// 4. BadgeSelectorDate — date picker with calendar
// ---------------------------------------------------------------------------

interface BadgeSelectorDateProps {
  icon?: ReactNode;
  value: Date | null;
  emptyLabel?: string;
  onSelect: (date: Date | null) => void | Promise<void>;
  className?: string;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function BadgeSelectorDate({
  icon,
  value,
  emptyLabel = "No date",
  onSelect,
  className,
}: BadgeSelectorDateProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = async (day: Date | undefined) => {
    await onSelect(day ?? null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button">
          <BadgeTrigger
            icon={icon ?? <CalendarIcon className="h-3 w-3" />}
            className={className}
          >
            {value ? formatShortDate(value) : emptyLabel}
          </BadgeTrigger>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={handleSelect}
          captionLayout="dropdown"
          defaultMonth={value ?? undefined}
        />
        {value && (
          <div className="border-t border-border px-3 py-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => { void onSelect(null); setOpen(false); }}
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
