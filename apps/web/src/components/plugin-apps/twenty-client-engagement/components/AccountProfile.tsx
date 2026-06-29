import { ExternalLink } from "lucide-react";
import { Button } from "@thinkwork/ui";

import type { EngagementAccount } from "../data/useTwentyEngagementData";
import { OpportunityList } from "./OpportunityList";

export function AccountProfile({
  account,
  onSelectOpportunity,
}: {
  account: EngagementAccount;
  onSelectOpportunity: (opportunityId: string) => void;
}) {
  return (
    <div className="space-y-5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {account.company.name}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {account.company.domainName ?? "Twenty CRM account"}
          </p>
        </div>
        {account.company.crmUrl ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={account.company.crmUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 size-3.5" />
              Open in CRM
            </a>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="Opportunities" value={account.opportunities.length} />
        <Metric
          label="Mapped layers"
          value={account.opportunities.reduce(
            (total, item) => total + item.layers.length,
            0,
          )}
        />
        <Metric
          label="Ready layers"
          value={account.opportunities.reduce(
            (total, item) =>
              total +
              item.layers.filter(
                (layer) =>
                  layer.layerStatus === "READY_FOR_SOW" ||
                  layer.layerStatus === "APPROVED",
              ).length,
            0,
          )}
        />
      </div>

      <OpportunityList
        opportunities={account.opportunities}
        onSelectOpportunity={onSelectOpportunity}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}
