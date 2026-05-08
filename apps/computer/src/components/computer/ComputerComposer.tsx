import { ArrowUp, Mic, Plus, Search } from "lucide-react";
import { Button, Textarea } from "@thinkwork/ui";

interface ComputerComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  error?: string | null;
}

export function ComputerComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  isSubmitting = false,
  error,
}: ComputerComposerProps) {
  const canSubmit = value.trim().length > 0 && !disabled && !isSubmitting;

  return (
    <form
      className="grid gap-4 rounded-2xl border border-border/80 bg-background/70 p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <Textarea
        aria-label="Ask your Computer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type @ for connectors and sources"
        className="min-h-24 resize-none border-0 bg-transparent p-1 text-lg shadow-none focus-visible:ring-0"
        disabled={disabled || isSubmitting}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" disabled>
            <Plus className="size-5" />
            <span className="sr-only">Add source</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-2 rounded-full"
            disabled
          >
            <Search className="size-4" />
            Search
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled>
            Model
          </Button>
          <Button type="button" variant="ghost" size="icon" disabled>
            <Mic className="size-4" />
            <span className="sr-only">Voice input</span>
          </Button>
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            disabled={!canSubmit}
            aria-label={isSubmitting ? "Starting" : "Start"}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
