import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "urql";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { CreateThreadMutation } from "@/lib/graphql-queries";
import { useAssignedComputerSelection } from "@/lib/use-assigned-computer-selection";

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId?: string;
  spaceName?: string;
}

interface CreateThreadResult {
  createThread: { id: string };
}

interface CreateThreadVars {
  input: {
    tenantId: string;
    computerId?: string;
    spaceId?: string;
    title: string;
    channel: "CHAT";
  };
}

export function NewThreadDialog({
  open,
  onOpenChange,
  spaceId,
  spaceName,
}: NewThreadDialogProps) {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [title, setTitle] = useState("New thread");
  const [error, setError] = useState<string | null>(null);
  const {
    computers,
    noAssignedComputers,
    selectedComputer,
    selectedComputerId,
    setSelectedComputerId,
  } = useAssignedComputerSelection({ pause: !open });
  const [{ fetching }, createThread] = useMutation<
    CreateThreadResult,
    CreateThreadVars
  >(CreateThreadMutation);

  const computerId = selectedComputer?.id ?? null;
  const canSubmit = !!tenantId && !fetching;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !tenantId) return;
    setError(null);

    const result = await createThread({
      input: {
        tenantId,
        computerId: computerId ?? undefined,
        spaceId,
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
    if (spaceId) {
      navigate({
        to: "/spaces/$spaceId/threads/$threadId",
        params: { spaceId, threadId: newId },
      });
    } else {
      navigate({ to: "/threads/$id", params: { id: newId } });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New thread</DialogTitle>
            <DialogDescription>
              {spaceName
                ? `Start a Thread in ${spaceName}.`
                : "Start a Thread from a Space."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            {noAssignedComputers ? (
              <p className="text-sm text-muted-foreground">
                This Thread will start in the selected Space. A mentionable
                agent can join when someone tags it.
              </p>
            ) : (
              <>
                {computers.length > 1 ? (
                  <>
                    <Label htmlFor="new-thread-computer">
                      Runtime workspace
                    </Label>
                    <Select
                      value={selectedComputerId ?? undefined}
                      onValueChange={setSelectedComputerId}
                    >
                      <SelectTrigger id="new-thread-computer">
                        <SelectValue placeholder="Select a workspace" />
                      </SelectTrigger>
                      <SelectContent>
                        {computers.map((computer) => (
                          <SelectItem key={computer.id} value={computer.id}>
                            {computer.name || computer.slug || "Workspace"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : null}
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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={fetching}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {fetching ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
