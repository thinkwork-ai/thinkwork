import { cn } from "@thinkwork/ui";

import type { OpportunityStage } from "../data/model";
import { OPPORTUNITY_TABS, stageIndex } from "../fixtures/prototype-pages";

export function OpportunityTabs({
  activeTab,
  stage,
  onTabChange,
}: {
  activeTab: number;
  stage: OpportunityStage;
  onTabChange: (tabIndex: number) => void;
}) {
  const currentStageIndex = stageIndex(stage);

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border px-4">
      {OPPORTUNITY_TABS.map((tab) => {
        const locked =
          tab.minStage !== null && currentStageIndex < stageIndex(tab.minStage);
        return (
          <button
            key={tab.index}
            type="button"
            disabled={locked}
            title={locked ? (tab.lockedLabel ?? undefined) : undefined}
            onClick={() => onTabChange(tab.index)}
            className={cn(
              "h-10 shrink-0 border-b-2 px-2 text-xs font-medium transition-colors",
              activeTab === tab.index
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
              locked &&
                "cursor-not-allowed opacity-45 hover:text-muted-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
