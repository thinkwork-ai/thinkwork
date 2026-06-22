import { cn } from "@/lib/utils";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from "@thinkwork/ui";
import { IconTargetArrow } from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";

export interface GoalModeToggleProps {
  enabled: boolean;
  objective?: string;
  disabled?: boolean;
  tone?: "light" | "dark";
  onClick: () => void;
}

export function GoalModeToggle({
  enabled,
  objective,
  disabled = false,
  tone = "light",
  onClick,
}: GoalModeToggleProps) {
  const trimmedObjective = objective?.trim();
  return (
    <button
      type="button"
      aria-label="Goal mode"
      aria-pressed={enabled}
      title={
        enabled
          ? trimmedObjective
            ? `Edit Goal: ${trimmedObjective}`
            : "Edit Goal"
          : "Start a Goal run"
      }
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-80 disabled:pointer-events-none disabled:opacity-50",
        tone === "dark"
          ? "text-white/60"
          : "text-muted-foreground hover:text-foreground",
        enabled && (tone === "dark" ? "text-[#54a9ff]" : "text-[#2563eb]"),
      )}
    >
      <IconTargetArrow stroke={2} className="size-5 shrink-0" />
    </button>
  );
}

export interface GoalModeDialogProps {
  open: boolean;
  initialObjective?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (objective: string) => void;
}

export function GoalModeDialog({
  open,
  initialObjective,
  onOpenChange,
  onSubmit,
}: GoalModeDialogProps) {
  const [draft, setDraft] = useState("");
  const trimmedDraft = draft.trim();

  useEffect(() => {
    if (open) setDraft(initialObjective?.trim() ?? "");
  }, [initialObjective, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedDraft) return;
    onSubmit(trimmedDraft);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Start Goal</DialogTitle>
            <DialogDescription className="sr-only">
              Enter the Goal objective.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="composer-goal-objective">Goal</Label>
            <Textarea
              id="composer-goal-objective"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder="Finish the launch checklist"
              autoFocus
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmedDraft}>
              Start Goal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
