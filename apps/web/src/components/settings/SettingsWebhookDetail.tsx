import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  CheckIcon,
  CopyIcon,
  RefreshCw,
  Trash2,
  WebhookIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
} from "@thinkwork/ui";
import { toast } from "sonner";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsDeleteWebhookMutation,
  SettingsRegenerateWebhookTokenMutation,
  SettingsSpacesListQuery,
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
  tenantId: string;
  name: string;
  description?: string | null;
  targetType: string;
  spaceId?: string | null;
  prompt?: string | null;
  enabled: boolean;
  rateLimit?: number | null;
};

type WebhookDelivery = {
  id: string;
  receivedAt: unknown;
  providerName?: string | null;
  normalizedKind?: string | null;
  signatureStatus: string;
  resolutionStatus: string;
  statusCode?: number | null;
  threadId?: string | null;
  threadCreated?: boolean | null;
  bodyPreview?: string | null;
  bodySizeBytes?: number | null;
  bodySha256?: string | null;
  sourceIp?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
};

const NO_SPACE_VALUE = "__none__";

type DeliveryStatusPresentation = {
  label: string;
  variant: "secondary" | "destructive" | "outline";
  className?: string;
  issueLabel?: "Warning" | "Error";
  issueClassName?: string;
};

export function isAcceptedWithWarning(
  delivery: Pick<
    WebhookDelivery,
    "threadCreated" | "statusCode" | "resolutionStatus" | "errorMessage"
  >,
): boolean {
  const statusCode = delivery.statusCode ?? 0;
  return (
    delivery.threadCreated === true &&
    delivery.resolutionStatus !== "error" &&
    statusCode >= 200 &&
    statusCode < 300 &&
    Boolean(delivery.errorMessage?.trim())
  );
}

export function deliveryStatusPresentation(
  delivery: Pick<
    WebhookDelivery,
    "threadCreated" | "statusCode" | "resolutionStatus" | "errorMessage"
  >,
): DeliveryStatusPresentation {
  if (isAcceptedWithWarning(delivery)) {
    return {
      label: "Accepted with warning",
      variant: "outline",
      className:
        "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200",
      issueLabel: "Warning",
      issueClassName: "text-amber-700 dark:text-amber-200",
    };
  }

  if (delivery.resolutionStatus === "error") {
    return {
      label: delivery.resolutionStatus,
      variant: "destructive",
      issueLabel: "Error",
      issueClassName: "text-destructive",
    };
  }

  return {
    label: delivery.resolutionStatus,
    variant: "secondary",
  };
}

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
    spaceId: webhook.spaceId ?? null,
    enabled: webhook.enabled,
    rateLimit: webhook.rateLimit != null ? String(webhook.rateLimit) : "",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [{ fetching: saving }, updateWebhook] = useMutation(
    SettingsUpdateWebhookMutation,
  );
  const [spacesResult] = useQuery({
    query: SettingsSpacesListQuery,
    variables: { tenantId: webhook.tenantId },
    requestPolicy: "cache-and-network",
  });
  const spaces = spacesResult.data?.spaces ?? [];

  useEffect(() => {
    setForm({
      name: webhook.name,
      description: webhook.description ?? "",
      prompt: webhook.prompt ?? "",
      spaceId: webhook.spaceId ?? null,
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
        spaceId: form.spaceId,
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
        label="Space"
        description="Threads created from this webhook will start in this Space."
      >
        <Select
          value={form.spaceId ?? NO_SPACE_VALUE}
          onValueChange={(value) =>
            setForm((f) => ({
              ...f,
              spaceId: value === NO_SPACE_VALUE ? null : value,
            }))
          }
          disabled={spacesResult.fetching && spaces.length === 0}
        >
          <SelectTrigger className="w-72">
            <SelectValue
              placeholder={
                spacesResult.fetching ? "Loading Spaces..." : "No Space"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SPACE_VALUE}>No Space</SelectItem>
            {spaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
  const [selectedDelivery, setSelectedDelivery] =
    useState<WebhookDelivery | null>(null);
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
            <DeliveryRow
              key={d.id}
              delivery={d}
              onSelect={() => setSelectedDelivery(d)}
            />
          ))}
        </div>
      )}
      <DeliveryDetailSheet
        delivery={selectedDelivery}
        onOpenChange={(open) => {
          if (!open) setSelectedDelivery(null);
        }}
      />
    </SettingsSection>
  );
}

function DeliveryRow({
  delivery,
  onSelect,
}: {
  delivery: WebhookDelivery;
  onSelect: () => void;
}) {
  const status = deliveryStatusPresentation(delivery);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {delivery.providerName ?? delivery.normalizedKind ?? "Delivery"}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDeliveryTime(delivery.receivedAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {delivery.threadCreated ? (
          <Badge variant="secondary" className="text-xs">
            Thread
          </Badge>
        ) : null}
        <Badge
          variant={status.variant}
          className={["text-xs", status.className].filter(Boolean).join(" ")}
        >
          {status.label}
        </Badge>
      </div>
    </button>
  );
}

function DeliveryDetailSheet({
  delivery,
  onOpenChange,
}: {
  delivery: WebhookDelivery | null;
  onOpenChange: (open: boolean) => void;
}) {
  const payload = formatPayloadPreview(delivery?.bodyPreview);
  const status = delivery ? deliveryStatusPresentation(delivery) : null;

  return (
    <Sheet open={Boolean(delivery)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(560px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/30">
              <WebhookIcon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <SheetTitle>Webhook delivery</SheetTitle>
              <SheetDescription>
                {delivery
                  ? formatDeliveryTime(delivery.receivedAt)
                  : "Delivery"}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {delivery ? (
          <div className="space-y-6 px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              {status ? (
                <Badge variant={status.variant} className={status.className}>
                  {status.label}
                </Badge>
              ) : null}
              {delivery.threadCreated ? (
                <Badge variant="secondary">Thread created</Badge>
              ) : null}
              {delivery.statusCode != null ? (
                <Badge variant="outline">HTTP {delivery.statusCode}</Badge>
              ) : null}
              {delivery.durationMs != null ? (
                <Badge variant="outline">{delivery.durationMs} ms</Badge>
              ) : null}
            </div>

            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
              <DeliveryMeta label="Provider">
                {delivery.providerName ?? delivery.normalizedKind ?? "Delivery"}
              </DeliveryMeta>
              <DeliveryMeta label="Signature">
                {delivery.signatureStatus}
              </DeliveryMeta>
              {delivery.threadId ? (
                <DeliveryMeta label="Thread">
                  <span className="font-mono text-xs">{delivery.threadId}</span>
                </DeliveryMeta>
              ) : null}
              {delivery.sourceIp ? (
                <DeliveryMeta label="Source IP">
                  {delivery.sourceIp}
                </DeliveryMeta>
              ) : null}
              {delivery.bodySizeBytes != null ? (
                <DeliveryMeta label="Body size">
                  {delivery.bodySizeBytes.toLocaleString()} bytes
                </DeliveryMeta>
              ) : null}
              {delivery.bodySha256 ? (
                <DeliveryMeta label="SHA-256">
                  <span className="font-mono text-xs">
                    {delivery.bodySha256}
                  </span>
                </DeliveryMeta>
              ) : null}
              {delivery.errorMessage ? (
                <DeliveryMeta label={status?.issueLabel ?? "Error"}>
                  <span
                    className={status?.issueClassName ?? "text-destructive"}
                  >
                    {delivery.errorMessage}
                  </span>
                </DeliveryMeta>
              ) : null}
            </dl>

            <section>
              <h3 className="text-sm font-medium text-foreground">Payload</h3>
              <pre className="mt-2 max-h-[50vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-5 text-foreground">
                <code>{payload}</code>
              </pre>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DeliveryMeta({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}

function formatPayloadPreview(value?: string | null): string {
  if (!value) return "No payload captured.";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
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
