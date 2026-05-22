import { Check, Copy, Mail } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation } from "urql";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SetSpaceEmailTriggersMutation } from "@/lib/graphql-queries";

export interface SpaceEmailTriggersToggleProps {
  tenantSlug: string;
  space: {
    id: string;
    slug: string;
    accessMode: string;
    status: string;
    emailTriggersEnabled: boolean;
  };
  onSaved?: () => void;
}

export function SpaceEmailTriggersToggle({
  tenantSlug,
  space,
  onSaved,
}: SpaceEmailTriggersToggleProps) {
  const [enabled, setEnabled] = useState(space.emailTriggersEnabled);
  const [copied, setCopied] = useState(false);
  const [mutationResult, setSpaceEmailTriggers] = useMutation(
    SetSpaceEmailTriggersMutation,
  );

  useEffect(() => {
    setEnabled(space.emailTriggersEnabled);
  }, [space.emailTriggersEnabled]);

  const emailAddress = useMemo(
    () => deriveSpaceEmailAddress(tenantSlug, space.slug),
    [space.slug, tenantSlug],
  );
  const archived = space.status === "ARCHIVED";
  const privateSpace = space.accessMode === "PRIVATE";

  async function handleToggle(nextEnabled: boolean) {
    const previous = enabled;
    setEnabled(nextEnabled);

    const response = await setSpaceEmailTriggers({
      spaceId: space.id,
      enabled: nextEnabled,
    });

    if (response.error) {
      setEnabled(previous);
      toast.error(`Could not update email triggers: ${response.error.message}`);
      return;
    }

    setEnabled(
      response.data?.setSpaceEmailTriggers.emailTriggersEnabled ?? nextEnabled,
    );
    toast.success(
      nextEnabled ? "Email triggers enabled." : "Email triggers disabled.",
    );
    onSaved?.();
  }

  async function copyAddress() {
    await navigator.clipboard.writeText(emailAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="rounded-md border p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
            <Label htmlFor="space-email-triggers" className="text-base">
              Email Triggers
            </Label>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Allow registered tenant users to start a thread by emailing this
            Space. Token-bearing replies to agent-initiated emails work
            regardless of this toggle.
          </p>
          <p className="text-sm text-muted-foreground">
            Cold-contact delivery to {emailAddress} is accepted only while email
            triggers are enabled.
          </p>
          <p className="text-sm text-muted-foreground">
            {privateSpace
              ? "Only members of this Space can send cold-contact email to this address."
              : "Any registered user in this tenant can send cold-contact email to this address when triggers are enabled."}
          </p>
          {archived ? (
            <p className="text-sm text-destructive">
              Archived Spaces cannot receive new cold-contact email.
            </p>
          ) : null}
        </div>
        <Switch
          id="space-email-triggers"
          checked={enabled}
          disabled={archived || mutationResult.fetching}
          onCheckedChange={(checked) => handleToggle(checked === true)}
          aria-label="Enable email triggers"
        />
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all text-sm text-foreground">
          {emailAddress}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={copyAddress}
          aria-label="Copy Space email address"
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>
    </section>
  );
}

function deriveSpaceEmailAddress(tenantSlug: string, spaceSlug: string) {
  return `${tenantSlug}.${spaceSlug}@agents.thinkwork.ai`;
}
