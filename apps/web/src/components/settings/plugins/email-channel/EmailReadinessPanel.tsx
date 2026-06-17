import { Badge, Button } from "@thinkwork/ui";
import { RotateCw, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SettingsEmailChannelQuery } from "@/gql/graphql";

type Summary = SettingsEmailChannelQuery["emailChannelSummary"];

const CHECK_LABELS: Record<string, string> = {
  CREDENTIALS: "Credentials",
  SENDING_DOMAIN: "Sending domain",
  INBOUND_RECEIVING: "Inbound receiving",
  WEBHOOK_SIGNATURE: "Webhook signature",
  PROVIDER_EVENTS: "Delivery events",
  LOOP_TEST: "Send and reply evidence",
};

const SETUP_CHECK_KEYS = [
  "CREDENTIALS",
  "SENDING_DOMAIN",
  "INBOUND_RECEIVING",
  "WEBHOOK_SIGNATURE",
];

const EVIDENCE_CHECK_KEYS = ["PROVIDER_EVENTS", "LOOP_TEST"];

export function EmailReadinessPanel({
  summary,
  probing,
  onRunProbe,
}: {
  summary: Summary;
  probing: boolean;
  onRunProbe: (providerInstallId: string) => void;
}) {
  const activeProvider =
    summary.providers.find((provider) => provider.activeForProduction) ??
    summary.providers[0] ??
    null;
  const setupReady = SETUP_CHECK_KEYS.every((key) =>
    summary.readinessChecks.some(
      (check) => check.checkKey === key && check.status === "PASS",
    ),
  );
  return (
    <div className="grid w-full gap-3">
      <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {summary.productionReady || setupReady ? (
            <ShieldCheck className="size-4 text-emerald-500" />
          ) : (
            <ShieldAlert className="size-4 text-amber-500" />
          )}
          <div>
            <p className="text-sm font-medium">
              {summary.productionReady || setupReady
                ? "Resend setup ready"
                : "Resend setup blocked"}
            </p>
            <p className="text-xs text-muted-foreground">
              Sending opens after the key, ThinkWork domain, receiving, and
              webhook checks pass. Delivery evidence updates after live traffic.
            </p>
          </div>
        </div>
        {activeProvider ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={probing}
            onClick={() => onRunProbe(activeProvider.id)}
          >
            <RotateCw className="size-4" />
            Run checks
          </Button>
        ) : null}
      </div>
      <div className="divide-y divide-border rounded-md border border-border">
        {Object.entries(CHECK_LABELS).map(([key, label]) => {
          const check = summary.readinessChecks.find(
            (candidate) => candidate.checkKey === key,
          );
          const evidenceOnly = EVIDENCE_CHECK_KEYS.includes(key);
          const statusLabel =
            evidenceOnly && check?.status !== "PASS"
              ? "waiting"
              : (check?.status?.toLowerCase().replace(/_/g, " ") ??
                "pending");
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-3 px-3 py-2.5"
            >
              <div>
                <p className="text-sm font-medium">{label}</p>
                {evidenceOnly && check?.status !== "PASS" ? (
                  <p className="text-xs text-muted-foreground">
                    Captured after the first live email event.
                  </p>
                ) : check?.failureMessage ? (
                  <p className="text-xs text-destructive">
                    {check.failureMessage}
                  </p>
                ) : check?.lastCheckedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Last checked{" "}
                    {new Date(check.lastCheckedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
              <Badge
                variant="outline"
                className={
                  check?.status === "PASS"
                    ? "border-emerald-500/40 text-emerald-400"
                    : evidenceOnly
                      ? "border-muted-foreground/30 text-muted-foreground"
                      : check?.status === "FAIL" || check?.status === "BLOCKED"
                      ? "border-amber-500/40 text-amber-500"
                      : undefined
                }
              >
                {statusLabel}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
