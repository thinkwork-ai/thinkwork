import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  describeImportError,
  type ImportBundleApiError,
} from "@/lib/agent-builder-api";

interface ImportErrorDialogProps {
  error: ImportBundleApiError | null;
  onClose: () => void;
}

export function ImportErrorDialog({ error, onClose }: ImportErrorDialogProps) {
  const copy = error ? describeImportError(error) : null;

  return (
    <Dialog open={Boolean(error)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent style={{ maxWidth: 480 }}>
        <DialogHeader>
          <DialogTitle>{copy?.title ?? "Import failed"}</DialogTitle>
          <DialogDescription>
            {copy?.description ?? "The bundle could not be imported."}
          </DialogDescription>
        </DialogHeader>
        {error?.details ? (
          <pre className="max-h-44 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {JSON.stringify(error.details, null, 2)}
          </pre>
        ) : null}
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
