import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "urql";
import { MoreHorizontal, Trash2 } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@thinkwork/ui";
import { DeleteArtifactMutation } from "@/lib/graphql-queries";

export interface ArtifactDetailActionsProps {
  artifactId: string;
  artifactTitle: string;
  /** Test seam: override where the user lands after Delete. */
  onDeleteNavigateTo?: string;
}

export function ArtifactDetailActions(props: ArtifactDetailActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <ArtifactActionsMenu onRequestDelete={() => setDeleteOpen(true)} />
      <ArtifactDeleteDialog
        {...props}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}

function ArtifactActionsMenu({
  onRequestDelete,
}: {
  onRequestDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Artifact actions"
          data-testid="artifact-actions-trigger"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuItem
          className="whitespace-nowrap"
          variant="destructive"
          data-testid="artifact-actions-delete"
          // Defer the dialog open one tick so Radix's menu-close
          // animation doesn't trap focus, blocking the dialog buttons.
          onSelect={() => {
            window.setTimeout(() => onRequestDelete(), 0);
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ArtifactDeleteDialogProps extends ArtifactDetailActionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Destructive delete dialog. Split out so unit tests can drive the
 * confirm/cancel flow without going through the Radix dropdown portal.
 */
export function ArtifactDeleteDialog({
  artifactId,
  artifactTitle,
  open,
  onOpenChange,
  onDeleteNavigateTo = "/artifacts",
}: ArtifactDeleteDialogProps) {
  const navigate = useNavigate();
  const [, deleteArtifact] = useMutation(DeleteArtifactMutation);
  const [working, setWorking] = useState(false);

  async function handleConfirm() {
    setWorking(true);
    try {
      const result = await deleteArtifact({ id: artifactId });
      if (result.error) {
        toast.error(`Could not delete artifact: ${result.error.message}`);
        return;
      }
      toast.success("Artifact deleted.");
      onOpenChange(false);
      void navigate({ to: onDeleteNavigateTo });
    } catch (err) {
      console.error("[ArtifactDetailActions] delete failed", err);
      toast.error(
        `Could not delete artifact: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="artifact-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this artifact?</AlertDialogTitle>
          <AlertDialogDescription>
            {artifactTitle ? <>&ldquo;{artifactTitle}&rdquo; </> : null}will be
            permanently removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="artifact-delete-confirm"
            disabled={working}
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
