import { type FormEvent, useState } from "react";
import { Badge, Button, Input, Label } from "@thinkwork/ui";
import { Plus, Trash2 } from "lucide-react";
import {
  EmailAllowlistType,
  type SettingsEmailChannelQuery,
} from "@/gql/graphql";

type Summary = SettingsEmailChannelQuery["emailChannelSummary"];

export function SpaceEmailPolicyPanel({
  summary,
  saving,
  removing,
  adding,
  onSavePolicy,
  onAddAllowlist,
  onRemoveAllowlist,
}: {
  summary: Summary;
  saving: boolean;
  removing: boolean;
  adding: boolean;
  onSavePolicy: (input: {
    spaceId: string;
    providerInstallId?: string;
    enabled: boolean;
  }) => void;
  onAddAllowlist: (input: {
    spaceId: string;
    valueType: EmailAllowlistType;
    value: string;
    reason?: string;
  }) => void;
  onRemoveAllowlist: (id: string) => void;
}) {
  const [spaceId, setSpaceId] = useState("");
  const [allowValue, setAllowValue] = useState("");
  const [allowReason, setAllowReason] = useState("");
  const activeProvider =
    summary.providers.find((provider) => provider.activeForProduction) ??
    summary.providers[0];

  function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = spaceId.trim();
    if (!trimmed) return;
    onSavePolicy({
      spaceId: trimmed,
      providerInstallId: activeProvider?.id,
      enabled: true,
    });
  }

  function addAllowlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedSpace = spaceId.trim();
    const trimmedValue = allowValue.trim();
    if (!trimmedSpace || !trimmedValue) return;
    onAddAllowlist({
      spaceId: trimmedSpace,
      valueType: trimmedValue.includes("@")
        ? EmailAllowlistType.Email
        : EmailAllowlistType.Domain,
      value: trimmedValue,
      reason: allowReason.trim() || undefined,
    });
    setAllowValue("");
    setAllowReason("");
  }

  return (
    <div className="grid gap-4">
      <form className="grid gap-3" onSubmit={savePolicy}>
        <div className="grid gap-1.5">
          <Label htmlFor="email-channel-space-id">Space ID</Label>
          <Input
            id="email-channel-space-id"
            value={spaceId}
            onChange={(event) => setSpaceId(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={saving}>
          Enable closed inbound policy
        </Button>
      </form>
      <form className="grid gap-3" onSubmit={addAllowlist}>
        <div className="grid gap-1.5">
          <Label htmlFor="email-channel-allowlist-value">
            Outside sender email or domain
          </Label>
          <Input
            id="email-channel-allowlist-value"
            value={allowValue}
            onChange={(event) => setAllowValue(event.currentTarget.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email-channel-allowlist-reason">Reason</Label>
          <Input
            id="email-channel-allowlist-reason"
            value={allowReason}
            onChange={(event) => setAllowReason(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={adding}>
          <Plus className="size-4" />
          Add allowlist
        </Button>
      </form>
      <div className="divide-y divide-border rounded-md border border-border">
        {summary.spacePolicies.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            No Space email policies configured.
          </p>
        ) : (
          summary.spacePolicies.map((policy) => (
            <div key={policy.id} className="grid gap-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-sm">{policy.spaceId}</p>
                <Badge variant="outline">
                  {policy.enabled ? "enabled" : "disabled"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Registered users allowed; private Spaces require membership;
                outside senders require allowlist; first send requires review.
              </p>
              {policy.allowlists.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>
                    {entry.value}{" "}
                    <span className="text-muted-foreground">
                      ({entry.valueType.toLowerCase()})
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={removing}
                    aria-label={`Remove ${entry.value}`}
                    onClick={() => onRemoveAllowlist(entry.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
