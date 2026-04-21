import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

interface RemoveHumanConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  humanName: string;
  onConfirm: () => Promise<void>;
  submitting: boolean;
}

export function RemoveHumanConfirmDialog({
  open,
  onOpenChange,
  humanName,
  onConfirm,
  submitting,
}: RemoveHumanConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {humanName}?</DialogTitle>
          <DialogDescription>
            This removes them from the tenant. Their user account is unaffected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={onConfirm}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
