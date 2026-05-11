import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "urql";
import { MoreHorizontal, Star, StarOff, Trash2 } from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@thinkwork/ui";
import {
  DeleteArtifactMutation,
  UpdateArtifactMutation,
} from "@/lib/graphql-queries";

export interface ArtifactDetailActionsProps {
  artifactId: string;
  artifactTitle: string;
  favoritedAt: string | null;
  /** Test seam: override where the user lands after Delete. */
  onDeleteNavigateTo?: string;
}

export function ArtifactDetailActions(props: ArtifactDetailActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <ArtifactActionsMenu {...props} onRequestDelete={() => setDeleteOpen(true)} />
      <ArtifactDeleteDialog
        {...props}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}

interface ArtifactActionsMenuProps extends ArtifactDetailActionsProps {
  onRequestDelete: () => void;
}

function ArtifactActionsMenu({
  artifactId,
  favoritedAt,
  onRequestDelete,
}: ArtifactActionsMenuProps) {
  const [, updateArtifact] = useMutation(UpdateArtifactMutation);
  const [working, setWorking] = useState(false);
  const isFavorited = favoritedAt !== null;

  async function handleToggleFavorite() {
    setWorking(true);
    try {
      const nextValue = isFavorited ? null : new Date().toISOString();
      const result = await updateArtifact({
        id: artifactId,
        input: { favoritedAt: nextValue },
      });
      if (result.error) {
        toast.error(
          `Could not ${isFavorited ? "remove" : "add"} favorite: ${result.error.message}`,
        );
        return;
      }
      toast.success(
        isFavorited ? "Removed from favorites." : "Added to favorites.",
      );
    } finally {
      setWorking(false);
    }
  }

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
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid="artifact-actions-favorite"
          disabled={working}
          onSelect={(event) => {
            event.preventDefault();
            void handleToggleFavorite();
          }}
        >
          {isFavorited ? (
            <>
              <StarOff className="mr-2 h-4 w-4" />
              Remove from favorites
            </>
          ) : (
            <>
              <Star className="mr-2 h-4 w-4" />
              Add to favorites
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          data-testid="artifact-actions-delete"
          disabled={working}
          onSelect={(event) => {
            event.preventDefault();
            onRequestDelete();
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
