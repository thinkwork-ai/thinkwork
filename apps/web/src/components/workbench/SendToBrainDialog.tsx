/**
 * "Send to the Brain" dialog (THINK-781).
 *
 * Flags a thread whose answer looks wrong to the ThinkWork Brain, whose
 * Platform Agent investigates it (THINK-780). Sibling of the eval-flag
 * dialog — investigation, not eval-case creation; a thread can be both.
 * One required input: a free-text "What looks wrong?" note that becomes
 * the investigation's steer. Success is confirmed inline (not a toast)
 * with the returned task id, because the user needs to read the
 * "you'll hear back via your operator" hand-off before dismissing.
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
import { FlagThreadToBrainMutation } from "@/lib/graphql-queries";

export interface SendToBrainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
}

interface AcceptedFlag {
  flagId: string;
  taskId: string | null;
  note: string | null;
}

export function SendToBrainDialog({
  open,
  onOpenChange,
  threadId,
}: SendToBrainDialogProps) {
  const [{ fetching: submitting }, flagToBrain] = useMutation(
    FlagThreadToBrainMutation,
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedFlag | null>(null);

  // Reset per open so a second flag never inherits stale state.
  useEffect(() => {
    if (!open) return;
    setNote("");
    setError(null);
    setAccepted(null);
  }, [open]);

  const canSubmit = !submitting && note.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    try {
      const result = await flagToBrain({
        input: { threadId, note: note.trim() },
      });
      if (result.error) {
        setError(
          result.error.graphQLErrors[0]?.message ??
            result.error.message ??
            "Couldn't reach the Brain — try again.",
        );
        return;
      }
      const payload = result.data?.flagThreadToBrain;
      if (!payload?.flagId) {
        setError("Couldn't reach the Brain — try again.");
        return;
      }
      setAccepted({
        flagId: payload.flagId,
        taskId: payload.taskId ?? null,
        note: payload.note ?? null,
      });
    } catch (err) {
      console.error("[SendToBrainDialog] flag failed", err);
      setError(err instanceof Error ? err.message : "unknown error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="send-to-brain-dialog">
        <DialogHeader>
          <DialogTitle>Send to the Brain</DialogTitle>
          <DialogDescription>
            Think this answer is wrong? Flag it and the Brain will investigate.
            This copies the raw conversation (including anything pasted into it)
            to the ThinkWork Brain.
          </DialogDescription>
        </DialogHeader>

        {accepted ? (
          <div className="grid gap-3" data-testid="send-to-brain-confirmation">
            <p className="text-sm">
              The Brain is investigating — you&apos;ll hear back via your
              operator.
            </p>
            <p className="text-xs text-muted-foreground">
              {accepted.taskId
                ? `Task ${accepted.taskId}`
                : `Flag ${accepted.flagId}`}
              {accepted.note ? ` — ${accepted.note}` : null}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="send-to-brain-note">What looks wrong?</Label>
            <Textarea
              id="send-to-brain-note"
              data-testid="send-to-brain-note"
              placeholder="Describe what looks wrong — this steers the investigation."
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
            />
            {error ? (
              <p
                className="text-xs text-destructive"
                data-testid="send-to-brain-error"
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
              data-testid="send-to-brain-done"
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
                data-testid="send-to-brain-submit"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                Send to the Brain
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
