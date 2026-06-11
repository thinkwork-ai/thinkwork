import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@thinkwork/ui";
import { SystemPromptViewer } from "@/components/workbench/SystemPromptViewer";
import type { TaskThreadTurn } from "@/components/workbench/TaskThreadView";
import { isRunningStatus } from "@/components/workbench/turnHeader";

export interface SystemPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persisted turns for the thread; the viewer reads, never recomputes. */
  turns: TaskThreadTurn[];
}

/**
 * Read-only, tree-less viewer for the exact persisted system prompt the model
 * received (R8). Shows the latest turn whose `systemPrompt` is non-null (KTD6),
 * bound to the reactive `turns` prop so it live-updates if a running turn
 * finalizes while the dialog is open.
 */
export function SystemPromptDialog({
  open,
  onOpenChange,
  turns,
}: SystemPromptDialogProps) {
  const selected = useMemo(() => selectPromptTurn(turns), [turns]);
  const prompt = selected?.systemPrompt ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] w-[75vw] max-w-[75vw] flex-col gap-3"
        data-testid="system-prompt-dialog"
      >
        <DialogHeader>
          <DialogTitle>System prompt</DialogTitle>
          <DialogDescription>
            The exact prompt the model received for this thread, captured when
            the turn completed. Read-only.
          </DialogDescription>
        </DialogHeader>

        {selected ? (
          <SystemPromptViewer prompt={prompt} />
        ) : (
          <p
            className="py-8 text-center text-sm text-muted-foreground"
            data-testid="system-prompt-empty"
          >
            {emptyStateMessage(turns)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Latest turn (by start time) that captured a non-empty system prompt. */
export function selectPromptTurn(
  turns: TaskThreadTurn[],
): TaskThreadTurn | null {
  const withPrompt = turns.filter(
    (turn) => (turn.systemPrompt ?? "").trim().length > 0,
  );
  if (withPrompt.length === 0) return null;
  return [...withPrompt].sort(
    (a, b) => startMs(b.startedAt) - startMs(a.startedAt),
  )[0];
}

function emptyStateMessage(turns: TaskThreadTurn[]): string {
  if (turns.length === 0) {
    return "No turns yet. The system prompt is captured the first time the agent runs.";
  }
  const latest = [...turns].sort(
    (a, b) => startMs(b.startedAt) - startMs(a.startedAt),
  )[0];
  if (latest && isRunningStatus(latest.status)) {
    return "This turn is still running. The system prompt is captured when it completes.";
  }
  return "No system prompt was captured for this thread yet.";
}

function startMs(startedAt: string | null | undefined): number {
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
