import { useEffect, useState } from "react";
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

export function InstallKeyDialog({
  open,
  onOpenChange,
  pluginName,
  prompt,
  submitting,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluginName: string;
  prompt: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (installKey: string) => void;
}) {
  const [installKey, setInstallKey] = useState("");

  useEffect(() => {
    if (!open) setInstallKey("");
  }, [open]);

  const trimmed = installKey.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Unlock {pluginName}</DialogTitle>
          <DialogDescription>{prompt}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed) onSubmit(trimmed);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="plugin-install-key">Install key</Label>
            <Input
              id="plugin-install-key"
              value={installKey}
              autoComplete="off"
              placeholder="twpi_..."
              onChange={(event) => setInstallKey(event.target.value)}
            />
          </div>
          {error ? (
            <p className="break-words text-sm text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || submitting}>
              Unlock and install
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
