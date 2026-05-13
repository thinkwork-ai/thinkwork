import { useState } from "react";
import { Loader2, Monitor } from "lucide-react";
import { useMutation } from "urql";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { InviteMemberMutation } from "@/lib/graphql-queries";

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onInvited?: () => void;
}

export function InviteMemberDialog({ open, onOpenChange, tenantId, onInvited }: InviteMemberDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [provisionComputer, setProvisionComputer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, executeMutation] = useMutation(InviteMemberMutation);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await executeMutation({
        tenantId,
        input: {
          email: email.trim(),
          name: name.trim() || undefined,
          provisionComputer,
        },
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setEmail("");
      setName("");
      setProvisionComputer(false);
      onOpenChange(false);
      onInvited?.();
    } catch (err: any) {
      setError(err.message ?? "Failed to invite member");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="member@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-name">Name (optional)</Label>
            <Input
              id="invite-name"
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <label
              htmlFor="invite-provision-computer"
              className="flex cursor-pointer items-start gap-3"
            >
              <input
                id="invite-provision-computer"
                type="checkbox"
                checked={provisionComputer}
                onChange={(e) => setProvisionComputer(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Monitor className="h-3.5 w-3.5 text-cyan-600" />
                  Provision a Computer for this member
                </div>
                <p className="text-xs text-muted-foreground">
                  Off by default — invitees are mobile-only unless you opt
                  them in here. You can always provision later from the
                  Person page.
                </p>
              </div>
            </label>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !email.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Send Invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
