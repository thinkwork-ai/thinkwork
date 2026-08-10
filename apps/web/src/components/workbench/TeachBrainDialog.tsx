/**
 * "Teach the Brain" dialog (THINK-784).
 *
 * A domain expert states knowledge in their own words and sends it to
 * the ThinkWork Brain for review. Sibling of the Send-to-the-Brain flag
 * dialog (THINK-781): flag = "this answer is wrong", teach = "here's
 * something the Brain should know". Opens globally (sidebar settings
 * menu, no thread context) or from a thread's flag dropdown (the thread
 * rides along as `context_thread_url`, resolved server-side).
 *
 * Attribution (`taught_by`) is derived from the signed-in caller by the
 * mutation — the expert never types their own identity. The success copy
 * is deliberately honest about review: an operator admits the teaching
 * before the Brain uses it; nothing is published unreviewed.
 */

import { useEffect, useState } from "react";
import { useMutation } from "urql";
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
import { TeachBrainMutation } from "@/lib/graphql-queries";

/** Client-side cap mirroring the Brain's 4000-char statement limit. */
export const TEACH_BRAIN_MAX_TEXT_CHARS = 4000;

export interface TeachBrainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When taught from a thread, the conversation rides along as context. */
  threadId?: string;
}

interface AcceptedTeaching {
  teachingId: string;
  taskId: string | null;
  note: string | null;
}

export function TeachBrainDialog({
  open,
  onOpenChange,
  threadId,
}: TeachBrainDialogProps) {
  const [{ fetching: submitting }, teachBrain] =
    useMutation(TeachBrainMutation);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedTeaching | null>(null);

  // Reset per open so a second teaching never inherits stale state.
  useEffect(() => {
    if (!open) return;
    setText("");
    setError(null);
    setAccepted(null);
  }, [open]);

  const canSubmit = !submitting && text.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    try {
      const result = await teachBrain({
        input: {
          text: text.trim().slice(0, TEACH_BRAIN_MAX_TEXT_CHARS),
          ...(threadId ? { threadId } : {}),
        },
      });
      if (result.error) {
        setError(
          result.error.graphQLErrors[0]?.message ??
            result.error.message ??
            "Couldn't reach the Brain — try again.",
        );
        return;
      }
      const payload = result.data?.teachBrain;
      if (!payload?.teachingId) {
        setError("Couldn't reach the Brain — try again.");
        return;
      }
      setAccepted({
        teachingId: payload.teachingId,
        taskId: payload.taskId ?? null,
        note: payload.note ?? null,
      });
    } catch (err) {
      console.error("[TeachBrainDialog] teach failed", err);
      setError(err instanceof Error ? err.message : "unknown error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="teach-brain-dialog">
        <DialogHeader>
          <DialogTitle>Teach the Brain</DialogTitle>
          <DialogDescription>
            Know something the Brain doesn&apos;t? Say it in your own words. The
            Brain grounds it against the data and drafts knowledge attributed to
            you
            {threadId ? " — this conversation is linked as context." : "."}
          </DialogDescription>
        </DialogHeader>

        {accepted ? (
          <div className="grid gap-3" data-testid="teach-brain-confirmation">
            <p className="text-sm">
              Sent for review — an operator admits it before the Brain uses it.
            </p>
            <p className="text-xs text-muted-foreground">
              Teaching {accepted.teachingId.slice(0, 8)}
              {accepted.note ? ` — ${accepted.note}` : null}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="teach-brain-text">
              What should the Brain know?
            </Label>
            <Textarea
              id="teach-brain-text"
              data-testid="teach-brain-text"
              placeholder="State it the way you'd tell a colleague — names, numbers, exceptions."
              value={text}
              maxLength={TEACH_BRAIN_MAX_TEXT_CHARS}
              onChange={(event) => setText(event.target.value)}
              rows={5}
            />
            {error ? (
              <p
                className="text-xs text-destructive"
                data-testid="teach-brain-error"
              >
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {accepted ? (
            <Button
              type="button"
              data-testid="teach-brain-done"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                data-testid="teach-brain-submit"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                Teach the Brain
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
