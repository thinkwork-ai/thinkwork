import { Badge } from "@thinkwork/ui";

import type { EngagementAccount } from "../data/useTwentyEngagementData";

export function AccountIndexPage({
  accounts,
  onSelectAccount,
}: {
  accounts: EngagementAccount[];
  onSelectAccount: (accountId: string) => void;
}) {
  return (
    <div className="p-5">
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_110px_110px_110px] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Account</div>
          <div>Domain</div>
          <div className="text-right">Opportunities</div>
          <div className="text-right">Mapped</div>
          <div className="text-right">Ready</div>
        </div>
        <div className="divide-y divide-border">
          {accounts.map((account) => {
            const metrics = accountMetrics(account);
            return (
              <button
                key={account.company.id}
                type="button"
                className="grid w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_110px_110px_110px] gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                onClick={() => onSelectAccount(account.company.id)}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {account.company.name}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Twenty CRM account
                  </div>
                </div>
                <div className="min-w-0 self-center text-sm text-muted-foreground">
                  <span className="block truncate">
                    {account.company.domainName ?? "No domain"}
                  </span>
                </div>
                <div className="self-center text-right text-sm font-medium text-foreground">
                  {metrics.opportunities}
                </div>
                <div className="self-center text-right text-sm font-medium text-foreground">
                  {metrics.mappedLayers}
                </div>
                <div className="self-center text-right">
                  <Badge variant="outline">{metrics.readyLayers}</Badge>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function accountMetrics(account: EngagementAccount) {
  return {
    opportunities: account.opportunities.length,
    mappedLayers: account.opportunities.reduce(
      (total, item) => total + item.layers.length,
      0,
    ),
    readyLayers: account.opportunities.reduce(
      (total, item) =>
        total +
        item.layers.filter(
          (layer) =>
            layer.layerStatus === "READY_FOR_SOW" ||
            layer.layerStatus === "APPROVED",
        ).length,
      0,
    ),
  };
}
