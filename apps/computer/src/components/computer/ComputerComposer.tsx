import { ArrowUp, Database, Search } from "lucide-react";
import { Badge, Button, Textarea } from "@thinkwork/ui";

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
      className="grid gap-3 rounded-lg border border-border/80 bg-background/70 p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <Textarea
        aria-label="Ask your Computer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Ask your Computer to research, analyze, or build..."
        className="min-h-28 resize-none border-0 bg-transparent p-1 text-base shadow-none focus-visible:ring-0"
        disabled={disabled || isSubmitting}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1.5 rounded-md">
            <Database className="size-3.5" />
            Business data
          </Badge>
          <Badge variant="outline" className="gap-1.5 rounded-md">
            <Search className="size-3.5" />
            Research
          </Badge>
        </div>
        <Button
          type="submit"
          size="sm"
          className="gap-2 self-end sm:self-auto"
          disabled={!canSubmit}
        >
          {isSubmitting ? "Starting..." : "Start"}
          <ArrowUp className="size-4" />
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
