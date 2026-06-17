import type { SettingsEmailChannelQuery } from "@/gql/graphql";

export function EmailLedgerPanel({
  summary,
}: {
  summary: SettingsEmailChannelQuery["emailChannelSummary"];
}) {
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <p className="font-medium">Ledger</p>
      <p className="mt-1 text-muted-foreground">
        {summary.ledgerEventCount} audit event
        {summary.ledgerEventCount === 1 ? "" : "s"} recorded for this channel.
      </p>
    </div>
  );
}
