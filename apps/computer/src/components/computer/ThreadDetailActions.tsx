import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "urql";
import { MoreHorizontal, Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Label,
} from "@thinkwork/ui";
import {
  DeleteArtifactMutation,
  DeleteThreadMutation,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";

export interface AttachedArtifactSummary {
  id: string;
  title: string;
}

export interface ThreadDetailActionsProps {
  threadId: string;
  threadTitle: string;
  attachedArtifacts: AttachedArtifactSummary[];
  /** Test seam: override the navigate destination after destructive actions. */
  onDoneNavigateTo?: string;
}

export function ThreadDetailActions(props: ThreadDetailActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();
  const [, updateThread] = useMutation(UpdateThreadMutation);
  const [working, setWorking] = useState(false);

  async function handleArchive() {
    setWorking(true);
    try {
      const result = await updateThread({
        id: props.threadId,
        input: { archivedAt: new Date().toISOString() },
      });
      if (result.error) {
        toast.error(`Could not archive thread: ${result.error.message}`);
        return;
      }
      toast.success("Thread archived.");
      void navigate({ to: props.onDoneNavigateTo ?? "/threads" });
    } catch (err) {
      console.error("[ThreadDetailActions] archive failed", err);
      toast.error(
        `Could not archive thread: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Thread actions"
            data-testid="thread-actions-trigger"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownMenuItem
            className="whitespace-nowrap"
            data-testid="thread-actions-archive"
            disabled={working}
            // No event.preventDefault — let Radix close the menu, then
            // the async work runs. Keeping the menu open during a
            // network request blocks focus from reaching subsequent
            // dialog buttons.
            onSelect={() => void handleArchive()}
          >
            <Archive className="mr-2 h-4 w-4" />
            Archive thread
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="whitespace-nowrap"
            variant="destructive"
            data-testid="thread-actions-delete"
            disabled={working}
            // Defer the dialog open by one frame so Radix's menu close
            // doesn't race with the dialog's open animation — otherwise
            // focus stays trapped in the menu and the dialog's Delete
            // button doesn't receive clicks.
            onSelect={() => {
              window.setTimeout(() => setDeleteOpen(true), 0);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete thread
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ThreadDeleteDialog
        {...props}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}

export interface ThreadDeleteDialogProps extends ThreadDetailActionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The destructive thread-delete dialog. Split out from
 * `ThreadDetailActions` so unit tests can drive the cascade-checkbox
 * + confirm flow without going through Radix's dropdown-menu portal.
 */
export function ThreadDeleteDialog({
  threadId,
  threadTitle,
  attachedArtifacts,
  onDoneNavigateTo = "/threads",
  open,
  onOpenChange,
}: ThreadDeleteDialogProps) {
  const navigate = useNavigate();
  const [, deleteThread] = useMutation(DeleteThreadMutation);
  const [, deleteArtifact] = useMutation(DeleteArtifactMutation);
  const [cascadeArtifacts, setCascadeArtifacts] = useState(false);
  const [working, setWorking] = useState(false);

  const artifactCount = attachedArtifacts.length;
  const hasAttached = artifactCount > 0;

  async function handleConfirmDelete() {
    setWorking(true);
    try {
      let deletedArtifactCount = 0;
      if (cascadeArtifacts && hasAttached) {
        const results = await Promise.allSettled(
          attachedArtifacts.map((a) => deleteArtifact({ id: a.id })),
        );
        deletedArtifactCount = results.filter(
          (r) =>
            r.status === "fulfilled" &&
            !(r.value as { error?: unknown }).error,
        ).length;
      }

      const result = await deleteThread({ id: threadId });
      if (result.error) {
        toast.error(`Could not delete thread: ${result.error.message}`);
        return;
      }

      if (cascadeArtifacts && hasAttached) {
        if (deletedArtifactCount === artifactCount) {
          toast.success(
            `Thread deleted along with ${artifactCount} artifact${
              artifactCount === 1 ? "" : "s"
            }.`,
          );
        } else {
          toast.warning(
            `Thread deleted. ${deletedArtifactCount} of ${artifactCount} attached artifacts removed; the rest can be deleted from the artifacts list.`,
          );
        }
      } else {
        toast.success("Thread deleted.");
      }
      onOpenChange(false);
      void navigate({ to: onDoneNavigateTo });
    } catch (err) {
      console.error("[ThreadDetailActions] delete failed", err);
      toast.error(
        `Could not delete thread: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setWorking(false);
    }
  }

  // Reset checkbox each time the dialog re-opens so it never starts checked.
  function handleOpenChange(next: boolean) {
    if (next) setCascadeArtifacts(false);
    onOpenChange(next);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="thread-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
          <AlertDialogDescription>
            {threadTitle ? <>&ldquo;{threadTitle}&rdquo; </> : null}will be
            permanently removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {hasAttached ? (
          <div className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/40 p-3">
            <Checkbox
              id="cascade-artifacts"
              data-testid="thread-delete-cascade"
              checked={cascadeArtifacts}
              onCheckedChange={(value) => setCascadeArtifacts(value === true)}
            />
            <Label
              htmlFor="cascade-artifacts"
              className="text-sm font-normal leading-snug"
            >
              Also delete the {artifactCount} attached artifact
              {artifactCount === 1 ? "" : "s"}.
            </Label>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="thread-delete-confirm"
            disabled={working}
            onClick={(event) => {
              event.preventDefault();
              void handleConfirmDelete();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
