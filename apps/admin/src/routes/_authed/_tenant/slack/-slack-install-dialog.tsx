import { Loader2, Slack } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SlackInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installing: boolean;
  error: string | null;
  onInstall: () => void;
}

const SCOPES = [
  "app_mentions:read",
  "chat:write",
  "chat:write.customize",
  "commands",
  "files:read",
  "users:read",
];

export function SlackInstallDialog({
  open,
  onOpenChange,
  installing,
  error,
  onInstall,
}: SlackInstallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Slack className="h-4 w-4" />
            Install Slack
          </DialogTitle>
          <DialogDescription>
            Connect a Slack workspace so linked members can invoke their
            Computer from Slack.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Requested bot scopes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SCOPES.map((scope) => (
                <Badge key={scope} variant="outline" className="text-xs">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={installing}
          >
            Cancel
          </Button>
          <Button onClick={onInstall} disabled={installing}>
            {installing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : null}
            Continue to Slack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
