import { Badge, Button } from "@thinkwork/ui";
import { RotateCw, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SettingsEmailChannelQuery } from "@/gql/graphql";

type Summary = SettingsEmailChannelQuery["emailChannelSummary"];

const CHECK_LABELS: Record<string, string> = {
  CREDENTIALS: "Credentials",
  SENDING_DOMAIN: "Sending domain",
  INBOUND_RECEIVING: "Inbound receiving",
  WEBHOOK_SIGNATURE: "Webhook signature",
  PROVIDER_EVENTS: "Provider events",
  LOOP_TEST: "Send and reply loop",
};

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
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="flex min-w-0 items-center gap-2">
          {summary.productionReady ? (
            <ShieldCheck className="size-4 text-emerald-500" />
          ) : (
            <ShieldAlert className="size-4 text-amber-500" />
          )}
          <div>
            <p className="text-sm font-medium">
              {summary.productionReady
                ? "Production email ready"
                : "Production email blocked"}
            </p>
            <p className="text-xs text-muted-foreground">
              Agent sends, routine sends, and inbound wakeups stay closed until
              every check passes.
            </p>
          </div>
        </div>
        {activeProvider ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
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
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-3 px-3 py-2.5"
            >
              <div>
                <p className="text-sm font-medium">{label}</p>
                {check?.failureMessage ? (
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
                    : check?.status === "FAIL" || check?.status === "BLOCKED"
                      ? "border-amber-500/40 text-amber-500"
                      : undefined
                }
              >
                {check?.status?.toLowerCase().replace(/_/g, " ") ?? "pending"}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
