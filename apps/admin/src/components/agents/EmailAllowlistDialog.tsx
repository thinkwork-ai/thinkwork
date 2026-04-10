import { useState } from "react";
import { useMutation } from "urql";
import { Mail, X, Copy, Check, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  UpdateAgentEmailAllowlistMutation,
  ToggleAgentEmailChannelMutation,
  ClaimVanityEmailAddressMutation,
  ReleaseVanityEmailAddressMutation,
} from "@/lib/graphql-queries";

export interface EmailCapabilityData {
  enabled: boolean;
  emailAddress: string | null;
  vanityAddress: string | null;
  allowedSenders: string[];
}

interface EmailAllowlistDialogProps {
  agentId: string;
  agentSlug: string;
  capability: EmailCapabilityData | null;
  fetching: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WILDCARD_RE = /^\*@[^\s@]+\.[^\s@]+$/;

function isValidEntry(value: string) {
  return EMAIL_RE.test(value) || WILDCARD_RE.test(value);
}

export function EmailAllowlistDialog({
  agentId,
  agentSlug,
  capability,
  fetching,
  open,
  onOpenChange,
  onRefresh,
}: EmailAllowlistDialogProps) {
  const [newEmail, setNewEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const [vanityCopied, setVanityCopied] = useState(false);
  const [vanityInput, setVanityInput] = useState("");
  const [vanityError, setVanityError] = useState("");
  const [vanityLoading, setVanityLoading] = useState(false);

  const [, updateAllowlist] = useMutation(UpdateAgentEmailAllowlistMutation);
  const [, toggleChannel] = useMutation(ToggleAgentEmailChannelMutation);
  const [, claimVanity] = useMutation(ClaimVanityEmailAddressMutation);
  const [, releaseVanity] = useMutation(ReleaseVanityEmailAddressMutation);

  const emailAddress = capability?.emailAddress ?? `${agentSlug}@agents.thinkwork.ai`;
  const vanityAddress = capability?.vanityAddress ?? null;
  const allowedSenders: string[] = capability?.allowedSenders ?? [];
  const enabled = capability?.enabled ?? false;

  const VANITY_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
  const isVanityValid = VANITY_RE.test(vanityInput.toLowerCase());

  const handleClaimVanity = async () => {
    const localPart = vanityInput.trim().toLowerCase();
    if (!VANITY_RE.test(localPart)) return;
    setVanityError("");
    setVanityLoading(true);
    const result = await claimVanity({ agentId, localPart });
    setVanityLoading(false);
    if (result.error) {
      const msg = result.error.message || "Failed to claim address";
      setVanityError(msg.includes("already taken") ? "This address is already taken" : msg);
    } else {
      setVanityInput("");
      onRefresh();
    }
  };

  const handleReleaseVanity = async () => {
    setVanityLoading(true);
    await releaseVanity({ agentId });
    setVanityLoading(false);
    onRefresh();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(emailAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggle = async (checked: boolean) => {
    await toggleChannel({ agentId, enabled: checked });
    onRefresh();
  };

  const handleAdd = async () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !isValidEntry(trimmed)) return;
    if (allowedSenders.includes(trimmed)) return;
    const updated = [...allowedSenders, trimmed];
    await updateAllowlist({ agentId, allowedSenders: updated });
    setNewEmail("");
    onRefresh();
  };

  const handleRemove = async (email: string) => {
    const updated = allowedSenders.filter((e) => e !== email);
    await updateAllowlist({ agentId, allowedSenders: updated });
    onRefresh();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email Channel
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {/* Default email address (read-only, copyable) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">
              Default Address
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm">
                {emailAddress}
              </code>
              <Button variant="ghost" size="icon" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Vanity address */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">
              Custom Address (optional)
            </label>
            {vanityAddress ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm">
                  {vanityAddress}@agents.thinkwork.ai
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    await navigator.clipboard.writeText(`${vanityAddress}@agents.thinkwork.ai`);
                    setVanityCopied(true);
                    setTimeout(() => setVanityCopied(false), 2000);
                  }}
                >
                  {vanityCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleReleaseVanity}
                  disabled={vanityLoading}
                >
                  {vanityLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  <Input
                    placeholder="e.g. marco"
                    value={vanityInput}
                    onChange={(e) => {
                      setVanityInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                      setVanityError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && isVanityValid) {
                        e.preventDefault();
                        handleClaimVanity();
                      }
                    }}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">@agents.thinkwork.ai</span>
                  <Button
                    size="sm"
                    onClick={handleClaimVanity}
                    disabled={!vanityInput.trim() || !isVanityValid || vanityLoading}
                  >
                    {vanityLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Claim"}
                  </Button>
                </div>
                {vanityError && (
                  <p className="text-xs text-destructive">{vanityError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  3-30 characters, lowercase letters, numbers, and hyphens.
                </p>
              </>
            )}
          </div>

          {/* Enable/Disable toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="email-enabled"
              checked={enabled}
              onCheckedChange={(checked) => handleToggle(checked === true)}
            />
            <label htmlFor="email-enabled" className="text-sm font-medium cursor-pointer">
              Email Channel Enabled
            </label>
          </div>

          {/* Allowlist */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Allowed Senders</label>
            <p className="text-xs text-muted-foreground">
              Only emails from these addresses (or wildcard domains like *@company.com) will be processed.
            </p>

            {fetching && !capability ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : allowedSenders.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No allowed senders yet.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {allowedSenders.map((email) => (
                  <div
                    key={email}
                    className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span className="truncate">{email}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => handleRemove(email)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="user@example.com or *@company.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!newEmail.trim() || !isValidEntry(newEmail.trim())}
              >
                Add
              </Button>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
