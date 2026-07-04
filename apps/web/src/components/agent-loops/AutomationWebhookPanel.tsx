import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import type {
  AgentLoopWebhookEndpoint,
  AutomationWebhookDelivery,
} from "./agent-loop-types";

/**
 * THINK-137 U8 (R8): the webhook endpoint + delivery history for a
 * webhook-trigger Automation, shown on the Automation detail. Replaces the
 * retired Settings → Webhooks surface. Deliveries are METADATA-ONLY — no
 * request body is fetched or rendered (the GraphQL field omits it).
 */

function apiBase(): string {
  const raw =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string | undefined> }).env
        ?.VITE_API_URL) ||
    "";
  return raw.replace(/\/$/, "");
}

export function AutomationWebhookEndpointPanel({
  endpoint,
}: {
  endpoint: AgentLoopWebhookEndpoint;
}) {
  const url = `${apiBase()}${endpoint.path}`;
  return (
    <section className="rounded-md border border-border/70 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Webhook endpoint
        </h2>
        <Badge variant={endpoint.enabled ? "default" : "secondary"}>
          {endpoint.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        POST inbound deliveries to this URL. The token is the only credential —
        keep it secret.
      </p>
      <CopyRow label="URL" value={url} />
      <CopyRow label="Token" value={endpoint.token} secret />
    </section>
  );
}

function CopyRow({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const display = secret ? maskToken(value) : value;
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-border/70 bg-muted/30 px-2 py-1 text-xs">
          {display}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="size-4" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function maskToken(token: string): string {
  if (token.length <= 10) return "••••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

export function AutomationWebhookDeliveriesPanel({
  deliveries,
}: {
  deliveries: AutomationWebhookDelivery[];
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
        Deliveries
      </h2>
      {deliveries.length === 0 ? (
        <div className="rounded-md border border-border/70 px-3 py-2 text-sm text-muted-foreground">
          No inbound deliveries recorded yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {deliveries.map((delivery) => (
            <li
              key={delivery.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/70 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">
                {formatTimestamp(delivery.receivedAt)}
              </span>
              <Badge variant={resolutionVariant(delivery.resolutionStatus)}>
                {delivery.resolutionStatus}
              </Badge>
              {typeof delivery.statusCode === "number" ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {delivery.statusCode}
                </span>
              ) : null}
              {delivery.isReplay ? (
                <Badge variant="secondary">replay</Badge>
              ) : null}
              {delivery.providerEventId ? (
                <span
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={delivery.providerEventId}
                >
                  {delivery.providerEventId}
                </span>
              ) : null}
              {delivery.errorMessage ? (
                <span className="w-full text-xs text-destructive">
                  {delivery.errorMessage}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function resolutionVariant(
  status: string,
): "default" | "secondary" | "destructive" {
  if (status === "ok") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
