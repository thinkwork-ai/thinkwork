import { Badge } from "@thinkwork/ui";

import type { EngagementOpportunityWithLayers } from "../data/useTwentyEngagementData";

export function OpportunityList({
  opportunities,
  onSelectOpportunity,
}: {
  opportunities: EngagementOpportunityWithLayers[];
  onSelectOpportunity: (opportunityId: string) => void;
}) {
  if (opportunities.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <h3 className="text-sm font-semibold text-foreground">
          No opportunities
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This account has no Twenty opportunities yet.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-muted/30 px-4 py-2 text-sm font-semibold">
        Opportunities
      </div>
      <div className="divide-y divide-border">
        {opportunities.map(({ opportunity, layers }) => {
          const readyLayers = layers.filter(
            (layer) =>
              layer.layerStatus === "READY_FOR_SOW" ||
              layer.layerStatus === "APPROVED",
          ).length;
          return (
            <button
              key={opportunity.id}
              type="button"
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3 text-left hover:bg-muted/40"
              onClick={() => onSelectOpportunity(opportunity.id)}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {opportunity.name}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{layers.length} layers mapped</span>
                  <span>{readyLayers} ready for SOW</span>
                  {opportunity.closeDate ? (
                    <span>Close {opportunity.closeDate}</span>
                  ) : null}
                </div>
              </div>
              <Badge variant="outline">{opportunity.stageLabel}</Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}
