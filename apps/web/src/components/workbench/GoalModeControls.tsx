import { cn } from "@/lib/utils";
import { ListChecks } from "lucide-react";

export interface GoalModeToggleProps {
  enabled: boolean;
  disabled?: boolean;
  tone?: "light" | "dark";
  onToggle: () => void;
}

export function GoalModeToggle({
  enabled,
  disabled = false,
  tone = "light",
  onToggle,
}: GoalModeToggleProps) {
  return (
    <button
      type="button"
      aria-label="Goal mode"
      aria-pressed={enabled}
      title={
        enabled
          ? "Goal mode uses the workspace default budget from Agent settings"
          : "Start a Goal run"
      }
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-80 disabled:pointer-events-none disabled:opacity-50",
        tone === "dark"
          ? "text-white/60"
          : "text-muted-foreground hover:text-foreground",
        enabled &&
          (tone === "dark"
            ? "text-emerald-300"
            : "text-emerald-600 hover:text-emerald-600"),
      )}
    >
      <ListChecks className="size-5" />
    </button>
  );
}
