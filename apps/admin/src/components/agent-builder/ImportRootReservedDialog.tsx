import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ImportBundleApiError } from "@/lib/agent-builder-api";

interface ImportRootReservedDialogProps {
  error: ImportBundleApiError | null;
  onCancel: () => void;
  onConfirm: (allowRootOverrides: string[]) => void;
}

export function ImportRootReservedDialog({
  error,
  onCancel,
  onConfirm,
}: ImportRootReservedDialogProps) {
  const protectedPath = useMemo(() => reservedPath(error), [error]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setChecked(false);
  }, [error]);

  return (
    <Dialog
      open={Boolean(error)}
      onOpenChange={(open) => {
        if (!open) {
          setChecked(false);
          onCancel();
        }
      }}
    >
      <DialogContent style={{ maxWidth: 480 }}>
        <DialogHeader>
          <DialogTitle>Confirm protected file override</DialogTitle>
          <DialogDescription>
            This import includes {protectedPath ?? "a protected root file"}.
            Protected root files affect the agent's core behavior and require
            explicit approval.
          </DialogDescription>
        </DialogHeader>
        <Label className="items-start rounded-md border p-3">
          <Checkbox
            checked={checked}
            onCheckedChange={(value) => setChecked(value === true)}
          />
          <span className="grid gap-1 text-sm">
            <span>Allow this import to replace {protectedPath}</span>
            <span className="text-xs font-normal text-muted-foreground">
              The import will be retried with this single override.
            </span>
          </span>
        </Label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!checked || !protectedPath}
            onClick={() => protectedPath && onConfirm([protectedPath])}
          >
            Import
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function reservedPath(error: ImportBundleApiError | null): string | null {
  const details = error?.details as
    | { allowRootOverride?: unknown; path?: unknown }
    | undefined;
  const path = details?.allowRootOverride ?? details?.path;
  return typeof path === "string" ? path : null;
}
