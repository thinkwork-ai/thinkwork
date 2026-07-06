import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button, Input } from "@thinkwork/ui";

/**
 * The Work Items collapsed-search affordance, extracted for the Artifacts
 * surfaces: an icon button that expands to an inline input and collapses
 * again when cleared/blurred empty. Controlled — callers own the value.
 */
export function CollapsedFilterSearch({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for both the button and the input. */
  label: string;
  placeholder?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isOpen = expanded || value.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const clearSearch = () => {
    onChange("");
    setExpanded(false);
  };

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-8 w-8 rounded-md"
        aria-label={label}
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(16rem,calc(100vw-2rem))] items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        aria-label={label}
        placeholder={placeholder ?? `${label}...`}
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={value}
        onBlur={() => {
          if (!value) setExpanded(false);
        }}
        onChange={(event) => onChange(event.target.value.trimStart())}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            clearSearch();
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
        aria-label={`Clear ${label.toLowerCase()}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={clearSearch}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
