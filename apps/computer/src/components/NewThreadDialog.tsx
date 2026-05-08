import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  CreateThreadMutation,
  MyComputerQuery,
} from "@/lib/graphql-queries";

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MyComputerResult {
  myComputer: { id: string; name?: string | null } | null;
}

interface CreateThreadResult {
  createThread: { id: string };
}

interface CreateThreadVars {
  input: {
    tenantId: string;
    computerId: string;
    title: string;
    channel: "CHAT";
  };
}

export function NewThreadDialog({ open, onOpenChange }: NewThreadDialogProps) {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [title, setTitle] = useState("New thread");
  const [error, setError] = useState<string | null>(null);
  const [{ data: myComputerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
    pause: !open,
  });
  const [{ fetching }, createThread] = useMutation<CreateThreadResult, CreateThreadVars>(
    CreateThreadMutation,
  );

  const computerId = myComputerData?.myComputer?.id ?? null;
  // myComputerData with a present `myComputer: null` field means the query
  // resolved but the caller has no Computer assigned. Distinguish that from
  // "still loading" so we can show an actionable message instead of leaving
  // the Create button permanently disabled with no feedback.
  const myComputerLoaded = myComputerData !== undefined;
  const noComputerAssigned = myComputerLoaded && computerId === null;
  const canSubmit = !!tenantId && !!computerId && !fetching;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !tenantId || !computerId) return;
    setError(null);

    const result = await createThread({
      input: {
        tenantId,
        computerId,
        title: title.trim() || "New thread",
        channel: "CHAT",
      },
    });

    if (result.error) {
      setError(result.error.message ?? "Failed to create thread");
      return;
    }

    const newId = result.data?.createThread?.id;
    if (!newId) {
      setError("Thread created but no id returned");
      return;
    }

    onOpenChange(false);
    setTitle("New thread");
    navigate({ to: "/tasks/$id", params: { id: newId } });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New thread</DialogTitle>
            <DialogDescription>
              Start a blank chat. You can rename it later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            {noComputerAssigned ? (
              <p className="text-sm text-muted-foreground">
                You don't have a Computer assigned yet. Ask your tenant operator
                to provision one before creating threads.
              </p>
            ) : (
              <>
                <Label htmlFor="new-thread-title">Title</Label>
                <Input
                  id="new-thread-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                  disabled={fetching}
                />
              </>
            )}
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={fetching}
            >
              {noComputerAssigned ? "Close" : "Cancel"}
            </Button>
            {!noComputerAssigned && (
              <Button type="submit" disabled={!canSubmit}>
                {fetching ? "Creating…" : "Create"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
