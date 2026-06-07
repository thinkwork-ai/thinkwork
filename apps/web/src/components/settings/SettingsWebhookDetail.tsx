import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { CheckIcon, CopyIcon, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Input, Switch, Textarea } from "@thinkwork/ui";
import { toast } from "sonner";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsDeleteWebhookMutation,
  SettingsRegenerateWebhookTokenMutation,
  SettingsUpdateWebhookMutation,
  SettingsWebhookDeliveriesQuery,
  SettingsWebhookQuery,
} from "@/lib/settings-queries";
import {
  SettingsPane,
  SettingsRow,
  SettingsSection,
  SettingsPageTitle,
} from "@/components/settings/SettingsContent";

export function SettingsWebhookDetail() {
  const { webhookId } = useParams({
    from: "/_authed/settings/webhooks/$webhookId",
  });
  const navigate = useNavigate();

  const [result, refetch] = useQuery({
    query: SettingsWebhookQuery,
    variables: { id: webhookId },
    requestPolicy: "cache-and-network",
  });
  const webhook = result.data?.webhook ?? null;

  const displayName = webhook
    ? webhook.name
    : result.fetching
      ? "Webhook"
      : "Webhook not found";

  usePageHeaderActions({
    title: displayName,
    breadcrumbs: [
      { label: "Webhooks", href: "/settings/webhooks" },
      { label: displayName },
    ],
  });

  if (result.fetching && !result.data) {
    return (
      <SettingsPane>
        <div className="flex items-center justify-center py-24">
          <LoadingShimmer />
        </div>
      </SettingsPane>
    );
  }

  if (!webhook) {
    return (
      <SettingsPane>
        <p className="text-sm text-muted-foreground">
          This webhook could not be loaded — it may have been removed.
        </p>
      </SettingsPane>
    );
  }

  return (
    <SettingsPane>
      <SettingsPageTitle
        title={displayName}
        badge={
          <Badge variant={webhook.enabled ? "default" : "secondary"}>
            {webhook.enabled ? "Enabled" : "Disabled"}
          </Badge>
        }
      />
      <ConfigSection
        webhook={webhook}
        onSaved={() => refetch({ requestPolicy: "network-only" })}
      />
      <EndpointSection
        webhookId={webhookId}
        token={webhook.token}
        onRegenerated={() => refetch({ requestPolicy: "network-only" })}
      />
      <DeliveriesSection webhookId={webhookId} />
      <DangerSection
        webhookId={webhookId}
        name={webhook.name}
        onDeleted={() => navigate({ to: "/settings/webhooks" })}
      />
    </SettingsPane>
  );
}

type WebhookConfig = {
  id: string;
  name: string;
  description?: string | null;
  targetType: string;
  prompt?: string | null;
  enabled: boolean;
  rateLimit?: number | null;
};

function ConfigSection({
  webhook,
  onSaved,
}: {
  webhook: WebhookConfig;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: webhook.name,
    description: webhook.description ?? "",
    prompt: webhook.prompt ?? "",
    enabled: webhook.enabled,
    rateLimit: webhook.rateLimit != null ? String(webhook.rateLimit) : "",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [{ fetching: saving }, updateWebhook] = useMutation(
    SettingsUpdateWebhookMutation,
  );

  useEffect(() => {
    setForm({
      name: webhook.name,
      description: webhook.description ?? "",
      prompt: webhook.prompt ?? "",
      enabled: webhook.enabled,
      rateLimit: webhook.rateLimit != null ? String(webhook.rateLimit) : "",
    });
  }, [webhook]);

  async function onSave() {
    setErrorMsg(null);
    setSaved(false);
    const trimmedRate = form.rateLimit.trim();
    const rate = trimmedRate === "" ? null : Number(trimmedRate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) {
      setErrorMsg("Rate limit must be a non-negative number.");
      return;
    }
    const res = await updateWebhook({
      id: webhook.id,
      input: {
        name: form.name.trim(),
        description: form.description,
        prompt: form.prompt,
        enabled: form.enabled,
        rateLimit: rate,
      },
    });
    if (res.error) {
      setErrorMsg(res.error.message);
      return;
    }
    setSaved(true);
    onSaved();
  }

  return (
    <SettingsSection label="Configuration">
      <SettingsRow label="Name" description="Display name for this webhook.">
        <Input
          className="w-72"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </SettingsRow>
      <SettingsRow
        label="Target"
        description="What an inbound call dispatches to."
      >
        <Badge variant="outline">{webhook.targetType}</Badge>
      </SettingsRow>
      <SettingsRow
        label="Description"
        description="Internal note about what this webhook is for."
      >
        <Textarea
          className="w-72"
          rows={2}
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Prompt"
        description="Instruction sent to the agent on each inbound call."
      >
        <Textarea
          className="w-72"
          rows={3}
          value={form.prompt}
          onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
        />
      </SettingsRow>
      <SettingsRow
        label="Enabled"
        description="Disable to reject inbound calls without deleting the webhook."
      >
        <Switch
          checked={form.enabled}
          onCheckedChange={(next) => setForm((f) => ({ ...f, enabled: next }))}
          aria-label="Enabled"
        />
      </SettingsRow>
      <SettingsRow
        label="Rate limit"
        description="Max calls per minute. Leave blank for no limit."
      >
        <Input
          className="w-72"
          type="number"
          min={0}
          placeholder="No limit"
          value={form.rateLimit}
          onChange={(e) =>
            setForm((f) => ({ ...f, rateLimit: e.target.value }))
          }
        />
      </SettingsRow>
      <div className="flex items-center justify-end gap-3 px-4 py-3.5">
        {saved ? (
          <span className="text-sm text-muted-foreground">Saved</span>
        ) : null}
        {errorMsg ? (
          <span className="text-sm text-destructive">{errorMsg}</span>
        ) : null}
        <Button onClick={onSave} disabled={saving || !form.name.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </SettingsSection>
  );
}

function EndpointSection({
  webhookId,
  token,
  onRegenerated,
}: {
  webhookId: string;
  token: string;
  onRegenerated: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [{ fetching }, regenerate] = useMutation(
    SettingsRegenerateWebhookTokenMutation,
  );

  async function onRegenerate() {
    const res = await regenerate({ id: webhookId });
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Webhook token regenerated");
    setConfirm(false);
    onRegenerated();
  }

  return (
    <SettingsSection label="Endpoint">
      <SettingsRow
        label="Token"
        description="Inbound URL token — POST to /webhooks/<token>."
      >
        <div className="w-72">
          <CopyableValue value={token} />
        </div>
      </SettingsRow>
      <div className="flex items-center justify-end gap-3 px-4 py-3.5">
        {confirm ? (
          <>
            <span className="text-sm text-muted-foreground">
              Existing callers will break.
            </span>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onRegenerate}
              disabled={fetching}
            >
              {fetching ? "Regenerating…" : "Confirm regenerate"}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            <RefreshCw className="mr-1.5 size-3.5" />
            Regenerate token
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

function DeliveriesSection({ webhookId }: { webhookId: string }) {
  const [result] = useQuery({
    query: SettingsWebhookDeliveriesQuery,
    variables: { webhookId, limit: 10 },
    requestPolicy: "cache-and-network",
  });
  const deliveries = result.data?.webhookDeliveries ?? [];

  return (
    <SettingsSection label="Recent deliveries">
      {deliveries.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          {result.fetching ? "Loading…" : "No deliveries yet."}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {deliveries.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {d.providerName ?? d.normalizedKind ?? "Delivery"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDeliveryTime(d.receivedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {d.threadCreated ? (
                  <Badge variant="secondary" className="text-xs">
                    Thread
                  </Badge>
                ) : null}
                <Badge
                  variant={
                    d.resolutionStatus === "error" ? "destructive" : "secondary"
                  }
                  className="text-xs"
                >
                  {d.resolutionStatus}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function DangerSection({
  webhookId,
  name,
  onDeleted,
}: {
  webhookId: string;
  name: string;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [{ fetching }, deleteWebhook] = useMutation(
    SettingsDeleteWebhookMutation,
  );

  async function onDelete() {
    const res = await deleteWebhook({ id: webhookId });
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`${name} deleted`);
    onDeleted();
  }

  return (
    <SettingsSection label="Danger zone">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Delete webhook</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Permanently removes this webhook and its endpoint.
          </p>
        </div>
        {confirm ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={fetching}
            >
              {fetching ? "Deleting…" : "Confirm delete"}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={() => setConfirm(true)}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

function formatDeliveryTime(value: unknown): string {
  if (!value) return "—";
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Read-only value field; click anywhere to copy. */
function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied — leave the value visible to select manually.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title="Click to copy"
      aria-label="Copy value"
      className="flex w-full items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-left font-mono text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <CheckIcon className="size-4 shrink-0 text-foreground" />
      ) : (
        <CopyIcon className="size-4 shrink-0 opacity-60" />
      )}
    </button>
  );
}
